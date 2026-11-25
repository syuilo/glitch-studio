import { getPortableParameterDefinitions, getPortableParameterDefaults } from './parameters.ts';
import { getPortableRenderResolution } from './protocol.ts';
import { PortableNodesEffectFrameRateLimiter } from './frame-rate-limiter.ts';
import type { PortableNodesEffect } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { PortableNodesEffectRequest, PortableNodesEffectResponse, PortablePointerClick, PortablePointerPosition } from './protocol.ts';

export function registerNodesEffectElement(tagName: string, artwork: PortableNodesEffect, workerSource: string, artworkModuleUrl: string | null = null) {
	// 同じ成果物を複数回読み込んでも登録済みのクラスを使う。タグは書き出しごとに一意にする。
	if (customElements.get(tagName) != null) return;
	const definitions = getPortableParameterDefinitions(artwork.nodesEffect);
	const defaults = getPortableParameterDefaults(definitions);
	const initial = structuredClone(artwork.initialParameters);

	class PortableNodesEffectElement extends HTMLElement {
		static observedAttributes = ['parameters', 'resolution-scale', 'max-pixels', 'fps-limit', 'paused'];
		private readonly root = this.attachShadow({ mode: 'open' });
		private canvas: HTMLCanvasElement | null = null;
		private readonly status = document.createElement('div');
		private readyState = Promise.withResolvers<void>();
		private connectedOnce = false;
		private worker: Worker | null = null;
		private workerUrl: string | null = null;
		private readyForFrames = false;
		private failed = false;
		private generation = 0;
		private listeners: AbortController | null = null;
		private resizeObserver: ResizeObserver | null = null;
		private intersectionObserver: IntersectionObserver | null = null;
		private visible = false;
		private physicalSize = { width: 0, height: 0 };
		private settings = { ...artwork.settings };
		private attributeParameters: Record<string, unknown> = {};
		private apiParameters: Record<string, unknown> = {};
		private parametersChanged = true;
		private frameId: number | null = null;
		private frameInFlight = false;
		private dirty = true;
		private resetHistory = true;
		private time = 0;
		private lastTick: number | null = null;
		private readonly frameRateLimiter = new PortableNodesEffectFrameRateLimiter();
		private pointerElementPosition: PortablePointerPosition | null = null;
		private pointerElementClicks: PortablePointerClick[] = [];

		constructor() {
			super();
			const style = document.createElement('style');
			style.textContent = `:host { display: block; position: relative; aspect-ratio: ${artwork.aspectRatio}; }
canvas { display: block; width: 100%; height: 100%; position: absolute; inset: 0; }
div { position: absolute; inset: 0; padding: 1em; font: 14px sans-serif; overflow: auto; }
div:empty { display: none; }`;
			this.root.append(style, this.status);
			// readyを待たない宣言的利用でも、初期化失敗をunhandled rejectionにしない。
			void this.ready.catch(() => {});
		}

		public get ready(): Promise<void> { return this.readyState.promise; }
		public get currentTime(): number { return this.time / 1000; }
		public get paused(): boolean { return this.hasAttribute('paused'); }
		public play() { this.removeAttribute('paused'); }
		public pause() { this.setAttribute('paused', ''); }
		public restart() {
			this.time = 0;
			this.pointerElementClicks = [];
			this.resetFrameTiming();
			this.resetHistory = true;
			if (this.failed) { this.disconnect(); this.connectedCallback(); }
			this.requestRender();
		}
		public setParameter(name: string, value: unknown) { this.setParameters({ [name]: value }); }
		public setParameters(values: Record<string, unknown>) {
			this.apiParameters = { ...this.apiParameters, ...structuredClone(values) };
			this.parametersChanged = true;
			this.requestRender();
		}
		public getParameter(name: string): unknown {
			return structuredClone(this.parameters()[name]);
		}
		public resetParameter(name: string) {
			delete this.apiParameters[name];
			this.parametersChanged = true;
			this.requestRender();
		}
		private parameters() { return { ...defaults, ...initial, ...this.attributeParameters, ...this.apiParameters }; }

		public attributeChangedCallback(name: string) {
			try {
				if (name === 'parameters') {
					this.attributeParameters = JSON.parse(this.getAttribute(name) ?? '{}');
					this.parametersChanged = true;
				} else if (name !== 'paused') {
					const fpsLimitAttribute = this.getAttribute('fps-limit');
					this.settings = {
						resolutionScale: Number(this.getAttribute('resolution-scale') ?? artwork.settings.resolutionScale),
						maxPixels: Number(this.getAttribute('max-pixels') ?? artwork.settings.maxPixels),
						fpsLimit: fpsLimitAttribute == null ? artwork.settings.fpsLimit : fpsLimitAttribute === 'auto' ? null : Number(fpsLimitAttribute),
					};
				}
				if (name === 'paused') this.resetFrameTiming();
				this.requestRender();
			} catch (error) { this.reportError(error, false); }
		}

		public connectedCallback() {
			if (this.worker != null || !this.isConnected) return;
			if (this.connectedOnce) {
				this.readyState = Promise.withResolvers<void>();
				void this.ready.catch(() => {});
			}
			this.connectedOnce = true;
			this.parametersChanged = true;
			this.failed = false;
			this.status.textContent = '';
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
				this.resetFrameTiming();
				this.requestRender();
			});
			this.resizeObserver.observe(this.canvas, { box: 'device-pixel-content-box' });
			this.intersectionObserver = new IntersectionObserver(entries => {
				this.visible = entries[0].isIntersecting;
				this.resetFrameTiming();
				this.schedule();
			});
			this.intersectionObserver.observe(this);
			this.ownerDocument.addEventListener('visibilitychange', () => { this.resetFrameTiming(); this.schedule(); }, { signal });
			const pointer = (event: PointerEvent) => {
				if (!event.isPrimary) return;
				const rect = this.canvas!.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				const position = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
				this.pointerElementPosition = position;
				if (event.type === 'pointerdown' && event.button === 0) {
					// FPS制限やWorkerの応答待ちでも、押下した瞬間をフレームと同じ時計に載せる。
					const elapsed = this.paused || this.lastTick == null ? 0 : Math.max(0, event.timeStamp - this.lastTick);
					this.pointerElementClicks.unshift({ position, time: this.time + elapsed });
					if (this.pointerElementClicks.length > 16) this.pointerElementClicks.pop();
				}
				this.requestRender();
			};
			this.canvas.addEventListener('pointermove', pointer, { signal });
			this.canvas.addEventListener('pointerdown', pointer, { signal });
			try {
				this.workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
				const worker = new Worker(this.workerUrl, { name: tagName });
				this.worker = worker;
				worker.addEventListener('error', event => { event.preventDefault(); this.reportError(new Error(event.message || 'Could not start the renderer worker. Check worker-src in the page CSP.'), true); }, { signal });
				worker.addEventListener('messageerror', () => this.reportError(new Error('Could not receive renderer data'), true), { signal });
				worker.addEventListener('message', (event: MessageEvent<PortableNodesEffectResponse>) => {
					if (generation !== this.generation) return;
					const message = event.data;
					if (message.type === 'ready') {
						this.readyForFrames = true;
						this.readyState.resolve();
						this.dispatchEvent(new CustomEvent('ready'));
						this.requestRender();
					} else if (message.type === 'error') this.reportError(new Error(message.message), true);
					else {
						this.frameInFlight = false;
						this.dispatchEvent(new CustomEvent('render', { detail: { resolution: message.resolution, time: message.time / 1000 } }));
						this.schedule();
					}
				}, { signal });
				const canvas = this.canvas.transferControlToOffscreen();
				const message: PortableNodesEffectRequest = { type: 'initialize', canvas, artwork, artworkModuleUrl };
				worker.postMessage(message, [canvas]);
			} catch (error) { this.reportError(error, true); }
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
			this.readyState.reject(new Error('Nodes Effect disconnected'));
			this.readyForFrames = false;
			this.frameInFlight = false;
			this.visible = false;
			this.pointerElementClicks = [];
			this.resetFrameTiming();
			this.resetHistory = true;
		}

		private reportError(error: unknown, fatal: boolean) {
			const message = error instanceof Error ? error.message : String(error);
			if (fatal) {
				this.failed = true;
				this.status.textContent = message;
				this.readyState.reject(new Error(message));
				this.disconnect();
			}
			this.dispatchEvent(new CustomEvent('error', { detail: { message, fatal } }));
		}

		private resetFrameTiming() { this.lastTick = null; this.frameRateLimiter.reset(); }
		private requestRender() { this.dirty = true; this.schedule(); }
		private schedule() {
			if (this.frameId != null || !this.readyForFrames || !this.visible || this.ownerDocument.hidden
				|| this.physicalSize.width <= 0 || this.physicalSize.height <= 0 || (this.paused && !this.dirty)) return;
			this.frameId = requestAnimationFrame(timestamp => this.tick(timestamp));
		}
		private tick(timestamp: number) {
			this.frameId = null;
			if (!this.readyForFrames || !this.visible || this.ownerDocument.hidden || this.physicalSize.width <= 0 || this.physicalSize.height <= 0) { this.resetFrameTiming(); return; }
			if (!this.paused && this.lastTick != null) this.time += timestamp - this.lastTick;
			this.lastTick = timestamp;
			if (!this.frameInFlight && (!this.paused || this.dirty) && this.frameRateLimiter.takeFrame(timestamp, this.settings.fpsLimit)) {
				const resolution = getPortableRenderResolution(this.physicalSize.width, this.physicalSize.height, this.settings)!;
				const message: PortableNodesEffectRequest = { type: 'frame', frame: {
					resolution, time: this.time, pointerElementPosition: this.pointerElementPosition, pointerElementClicks: this.pointerElementClicks,
					parameters: this.parametersChanged ? this.parameters() : null, resetHistory: this.resetHistory,
				} };
				this.worker!.postMessage(message);
				this.dirty = false;
				this.parametersChanged = false;
				this.resetHistory = false;
				this.frameInFlight = true;
			}
			this.schedule();
		}
	}
	customElements.define(tagName, PortableNodesEffectElement);
}
