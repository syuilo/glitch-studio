import { getPortableParameterDefinitions, getPortableParameterDefaults } from './parameters.ts';
import { getPortableRenderResolution } from './protocol.ts';
import { PortableNodesEffectFrameRateLimiter } from './frame-rate-limiter.ts';
import { getPointerStrokeEvents, PointerStrokeInput } from '@gs/glitch-studio_shared/pointer-stroke-input.ts';
import type { PortableNodesEffect } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { PortableNodesEffectRequest, PortableNodesEffectResponse, PortablePointerClick, PortablePointerPosition } from './protocol.ts';

export function registerNodesEffectElement(tagName: string, artwork: PortableNodesEffect, workerSource: string, artworkModuleUrl: string | null = null) {
	// 同じ成果物を複数回読み込んでも登録済みのクラスを使う。タグは書き出しごとに一意にする。
	if (customElements.get(tagName) != null) return;
	const definitions = getPortableParameterDefinitions(artwork.nodesEffect);
	const initialParameters = { ...getPortableParameterDefaults(definitions), ...structuredClone(artwork.initialParameters) };
	const { resolutionScale, fpsLimit } = artwork.settings;

	class PortableNodesEffectElement extends HTMLElement {
		private readonly root = this.attachShadow({ mode: 'open' });
		private canvas: HTMLCanvasElement | null = null;
		private worker: Worker | null = null;
		private workerUrl: string | null = null;
		private generation = 0;
		private listeners: AbortController | null = null;
		private resizeObserver: ResizeObserver | null = null;
		private intersectionObserver: IntersectionObserver | null = null;
		private visible = false;
		private physicalSize = { width: 0, height: 0 };
		private parameterOverrides: Record<string, unknown> = {};
		private parametersChanged = true;
		private frameId: number | null = null;
		private frameInFlight = false;
		private resetHistory = true;
		private playbackStartTimestamp: number | null = null;
		private readonly frameRateLimiter = new PortableNodesEffectFrameRateLimiter();
		private pointerElementPosition: PortablePointerPosition | null = null;
		private pointerElementClicks: PortablePointerClick[] = [];
		private readonly pointerStroke = new PointerStrokeInput();
		private pointerStrokeStartTimestamp = 0;

		constructor() {
			super();
			const style = document.createElement('style');
			style.textContent = `:host { display: block; position: relative; aspect-ratio: ${artwork.aspectRatio}; }
canvas { display: block; width: 100%; height: 100%; position: absolute; inset: 0; }`;
			this.root.append(style);
		}

		public setParameter(name: string, value: unknown) { this.setParameters({ [name]: value }); }
		public setParameters(values: Record<string, unknown>) {
			this.parameterOverrides = { ...this.parameterOverrides, ...structuredClone(values) };
			this.parametersChanged = true;
		}
		public getParameter(name: string): unknown {
			return structuredClone(this.parameters()[name]);
		}
		public resetParameter(name: string) {
			delete this.parameterOverrides[name];
			this.parametersChanged = true;
		}
		private parameters() { return { ...initialParameters, ...this.parameterOverrides }; }

		public connectedCallback() {
			if (this.worker != null || !this.isConnected) return;
			this.parametersChanged = true;
			this.canvas?.remove();
			this.canvas = document.createElement('canvas');
			this.root.prepend(this.canvas);
			this.listeners = new AbortController();
			const signal = this.listeners.signal;
			const generation = ++this.generation;
			this.resizeObserver = new ResizeObserver(entries => {
				const entry = entries[0];
				const physical = entry.devicePixelContentBoxSize?.[0];
				const vertical = getComputedStyle(this.canvas!).writingMode.startsWith('vertical');
				this.physicalSize = physical == null
					? { width: entry.contentRect.width * devicePixelRatio, height: entry.contentRect.height * devicePixelRatio }
					: { width: vertical ? physical.blockSize : physical.inlineSize, height: vertical ? physical.inlineSize : physical.blockSize };
				this.updateRenderingAvailability();
			});
			this.resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
			this.intersectionObserver = new IntersectionObserver(entries => {
				this.visible = entries[0].isIntersecting;
				this.updateRenderingAvailability();
			});
			this.intersectionObserver.observe(this);
			this.ownerDocument.addEventListener('visibilitychange', () => this.updateRenderingAvailability(), { signal });
			const pointerTimeOriginOffset = (this.ownerDocument.defaultView?.performance.timeOrigin ?? performance.timeOrigin) - performance.timeOrigin;
			const pointer = (event: PointerEvent) => {
				if (!event.isPrimary) return;
				const rect = this.canvas!.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				const toCanvasPosition = ({ clientX, clientY }: PointerEvent) => ({ x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height });
				const position = toCanvasPosition(event);
				this.pointerElementPosition = position;
				if (event.type === 'pointerdown' && event.button === 0) {
					// FPS制限やWorkerの応答待ちでも、押下した瞬間をフレームと同じ時計に載せる。
					this.pointerElementClicks.unshift({ position, time: this.getPlaybackTime(event.timeStamp + pointerTimeOriginOffset) });
					if (this.pointerElementClicks.length > 16) this.pointerElementClicks.pop();
				}
				if (!this.canRender()) return;
				for (const sample of getPointerStrokeEvents(event)) {
					const timestamp = sample.timeStamp + pointerTimeOriginOffset;
					// 再表示後にまとめて届いた入力に、休止中の軌跡が含まれている場合も除外する。
					if (timestamp < this.pointerStrokeStartTimestamp) continue;
					const samplePosition = sample === event ? position : toCanvasPosition(sample);
					const { x, y } = samplePosition;
					if (x >= 0 && x <= 1 && y >= 0 && y <= 1 && (sample.pointerType !== 'touch' || (sample.buttons & 1) !== 0)) {
						this.pointerStroke.sample(event.pointerId, samplePosition, this.getPlaybackTime(timestamp) / 1000);
					} else this.pointerStroke.end(event.pointerId);
				}
			};
			const endPointerStroke = (event: PointerEvent) => { if (event.isPrimary) this.pointerStroke.end(event.pointerId); };
			this.canvas.addEventListener('pointerenter', pointer, { signal });
			this.canvas.addEventListener('pointermove', pointer, { signal });
			this.canvas.addEventListener('pointerdown', pointer, { signal });
			this.canvas.addEventListener('pointerleave', endPointerStroke, { signal });
			this.canvas.addEventListener('pointercancel', endPointerStroke, { signal });
			this.canvas.addEventListener('pointerup', event => { if (event.pointerType === 'touch') endPointerStroke(event); }, { signal });
			this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
			const worker = new Worker(this.workerUrl, { name: tagName });
			this.worker = worker;
			worker.addEventListener('message', (event: MessageEvent<PortableNodesEffectResponse>) => {
				if (generation !== this.generation) return;
				if (event.data.type === 'ready') this.playbackStartTimestamp = performance.now();
				else this.frameInFlight = false;
				this.schedule();
			}, { signal });
			const canvas = this.canvas.transferControlToOffscreen();
			const message: PortableNodesEffectRequest = { type: 'initialize', canvas, artwork, artworkModuleUrl };
			worker.postMessage(message, [canvas]);
		}

		public disconnectedCallback() {
			// 同一Document内のDOM移動でGPUと履歴を破棄しない。本当の削除は次のmicrotaskで確定する。
			queueMicrotask(() => { if (!this.isConnected) this.disconnect(); });
		}

		private disconnect() {
			++this.generation;
			this.listeners?.abort();
			this.resizeObserver?.disconnect();
			this.intersectionObserver?.disconnect();
			if (this.frameId != null) cancelAnimationFrame(this.frameId);
			this.frameId = null;
			this.worker?.postMessage({ type: 'dispose' } satisfies PortableNodesEffectRequest);
			this.worker?.terminate();
			this.worker = null;
			if (this.workerUrl != null) URL.revokeObjectURL(this.workerUrl);
			this.workerUrl = null;
			this.playbackStartTimestamp = null;
			this.frameInFlight = false;
			this.visible = false;
			this.physicalSize = { width: 0, height: 0 };
			this.pointerElementClicks = [];
			this.resetFrameRateLimiterAndPointerStroke();
			this.resetHistory = true;
		}

		private getPlaybackTime(timestamp: number): number {
			// 描画の休止中も同じ起点を使い、新しい接続では初期化完了を0秒とする。
			const startTimestamp = this.playbackStartTimestamp;
			return startTimestamp == null ? 0 : Math.max(0, timestamp - startTimestamp);
		}
		private resetFrameRateLimiterAndPointerStroke() {
			this.frameRateLimiter.reset();
			this.pointerStroke.reset();
			this.pointerStrokeStartTimestamp = performance.now();
		}
		private canRender(): boolean {
			return this.visible && !this.ownerDocument.hidden && this.physicalSize.width > 0 && this.physicalSize.height > 0;
		}
		private updateRenderingAvailability() {
			this.resetFrameRateLimiterAndPointerStroke();
			// 再表示時には現在の作品時刻へ進むので、休止前の画像を直前のフレームとして使わない。
			if (!this.canRender()) this.resetHistory = true;
			this.schedule();
		}
		private schedule() {
			if (this.frameId != null || this.frameInFlight || this.playbackStartTimestamp == null || !this.canRender()) return;
			this.frameId = requestAnimationFrame(timestamp => this.tick(timestamp));
		}
		private tick(timestamp: number) {
			this.frameId = null;
			if (!this.canRender()) { this.updateRenderingAvailability(); return; }
			if (this.frameRateLimiter.takeFrame(timestamp, fpsLimit)) {
				const resolution = getPortableRenderResolution(this.physicalSize.width, this.physicalSize.height, resolutionScale)!;
				const message: PortableNodesEffectRequest = { type: 'frame', frame: {
					resolution, time: this.getPlaybackTime(timestamp), pointerElementPosition: this.pointerElementPosition, pointerElementClicks: this.pointerElementClicks,
					pointerElementStrokeSegments: this.pointerStroke.takeSegments(),
					parameters: this.parametersChanged ? this.parameters() : null, resetHistory: this.resetHistory,
				} };
				this.worker!.postMessage(message);
				this.parametersChanged = false;
				this.resetHistory = false;
				this.frameInFlight = true;
			}
			this.schedule();
		}
	}
	customElements.define(tagName, PortableNodesEffectElement);
}
