import { getPortableParameterDefinitions, getPortableParameterDefaults } from './parameters.ts';
import { getPointerStrokeEvents } from '@gs/glitch-studio_shared/pointer-stroke-input.ts';
import type { PortableNodesEffect } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
import type { PortableNodesEffectRendererConnection, PortableNodesEffectRendererInitialization, PortablePointerPosition } from './protocol.ts';

export function registerNodesEffectElement(tagName: string, artwork: PortableNodesEffect, artworkModuleUrl: string | null,
	connectRenderer: (initialization: PortableNodesEffectRendererInitialization) => PortableNodesEffectRendererConnection) {
	// 同じ成果物を複数回読み込んでも登録済みのクラスを使う。タグは書き出しごとに一意にする。
	if (customElements.get(tagName) != null) return;
	const definitions = getPortableParameterDefinitions(artwork.nodesEffect);
	const initialParameters = { ...getPortableParameterDefaults(definitions), ...structuredClone(artwork.initialParameters) };

	class PortableNodesEffectElement extends HTMLElement {
		private readonly root = this.attachShadow({ mode: 'open' });
		private canvas: HTMLCanvasElement | null = null;
		private renderer: PortableNodesEffectRendererConnection | null = null;
		private listeners: AbortController | null = null;
		private resizeObserver: ResizeObserver | null = null;
		private intersectionObserver: IntersectionObserver | null = null;
		private visible = false;
		private physicalSize = { width: 0, height: 0 };
		private parameterOverrides: Record<string, unknown> = {};
		private pointerElementPosition: PortablePointerPosition | null = null;

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
			this.renderer?.update({ type: 'parameters', parameters: this.parameters() });
		}
		public getParameter(name: string): unknown {
			return structuredClone(this.parameters()[name]);
		}
		public resetParameter(name: string) {
			delete this.parameterOverrides[name];
			this.renderer?.update({ type: 'parameters', parameters: this.parameters() });
		}
		private parameters() { return { ...initialParameters, ...this.parameterOverrides }; }

		public connectedCallback() {
			if (this.renderer != null || !this.isConnected) return;
			this.canvas?.remove();
			const canvas = this.ownerDocument.createElement('canvas');
			this.canvas = canvas;
			this.root.prepend(canvas);
			const renderer = connectRenderer({ canvas: canvas.transferControlToOffscreen(), artwork, artworkModuleUrl,
				parameters: this.parameters(), pointerElementPosition: this.pointerElementPosition });
			this.renderer = renderer;
			this.listeners = new AbortController();
			const signal = this.listeners.signal;
			this.resizeObserver = new ResizeObserver(entries => {
				if (signal.aborted) return;
				const entry = entries[0];
				const physical = entry.devicePixelContentBoxSize?.[0];
				const vertical = getComputedStyle(canvas).writingMode.startsWith('vertical');
				this.physicalSize = physical == null
					? { width: entry.contentRect.width * devicePixelRatio, height: entry.contentRect.height * devicePixelRatio }
					: { width: vertical ? physical.blockSize : physical.inlineSize, height: vertical ? physical.inlineSize : physical.blockSize };
				this.updateLayout();
			});
			this.resizeObserver.observe(canvas, { box: 'device-pixel-content-box' });
			this.intersectionObserver = new IntersectionObserver(entries => {
				if (signal.aborted) return;
				this.visible = entries[0].isIntersecting;
				this.updateLayout();
			});
			this.intersectionObserver.observe(this);
			this.ownerDocument.addEventListener('visibilitychange', () => this.updateLayout(), { signal });
			const pointerTimeOrigin = this.ownerDocument.defaultView?.performance.timeOrigin ?? performance.timeOrigin;
			const pointer = (event: PointerEvent) => {
				if (!event.isPrimary) return;
				const rect = canvas.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return;
				const toCanvasPosition = ({ clientX, clientY }: PointerEvent) => ({ x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height });
				const position = toCanvasPosition(event);
				this.pointerElementPosition = position;
				const clickTimestamp = event.type === 'pointerdown' && event.button === 0 ? pointerTimeOrigin + event.timeStamp : null;
				const samples = this.canRender() ? getPointerStrokeEvents(event).map(sample => {
					const samplePosition = sample === event ? position : toCanvasPosition(sample);
					const { x, y } = samplePosition;
					const insideStroke = x >= 0 && x <= 1 && y >= 0 && y <= 1 && (sample.pointerType !== 'touch' || (sample.buttons & 1) !== 0);
					return { position: insideStroke ? samplePosition : null, timestamp: pointerTimeOrigin + sample.timeStamp };
				}) : [];
				renderer.update({ type: 'pointer', pointerId: event.pointerId, position, clickTimestamp, samples });
			};
			const endPointerStroke = (event: PointerEvent) => {
				if (event.isPrimary) renderer.update({ type: 'endPointerStroke', pointerId: event.pointerId });
			};
			canvas.addEventListener('pointerenter', pointer, { signal });
			// 同じ移動のサンプルを二重に取り込まないよう、対応状況に応じて移動イベントを一方だけ購読する。
			const pointerMoveEventType = 'onpointerrawupdate' in canvas ? 'pointerrawupdate' : 'pointermove';
			canvas.addEventListener(pointerMoveEventType, event => pointer(event as PointerEvent), { passive: true, signal });
			canvas.addEventListener('pointerdown', pointer, { signal });
			canvas.addEventListener('pointerleave', endPointerStroke, { signal });
			canvas.addEventListener('pointercancel', endPointerStroke, { signal });
			canvas.addEventListener('pointerup', event => { if (event.pointerType === 'touch') endPointerStroke(event); }, { signal });
		}

		public disconnectedCallback() {
			// 同一Document内のDOM移動でGPUと履歴を破棄しない。本当の削除は次のmicrotaskで確定する。
			queueMicrotask(() => { if (!this.isConnected) this.disconnect(); });
		}

		private disconnect() {
			this.listeners?.abort();
			this.resizeObserver?.disconnect();
			this.intersectionObserver?.disconnect();
			const renderer = this.renderer;
			this.renderer = null;
			renderer?.dispose();
			this.visible = false;
			this.physicalSize = { width: 0, height: 0 };
		}

		private canRender(): boolean {
			return this.visible && !this.ownerDocument.hidden && this.physicalSize.width > 0 && this.physicalSize.height > 0;
		}
		private updateLayout() {
			this.renderer?.update({ type: 'layout', physicalSize: this.physicalSize, canRender: this.canRender(),
				timestamp: performance.timeOrigin + performance.now() });
		}
	}
	customElements.define(tagName, PortableNodesEffectElement);
}
