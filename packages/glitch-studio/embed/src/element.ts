import { validatePortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import { getPortableParameterDefaults, validatePortableParameters } from './parameters.ts';
import { getPortableRenderResolution } from './protocol.ts';
import { PortableVisualModuleFrameRateLimiter } from './frame-rate-limiter.ts';
import type { PortableVisualModule, PortableVisualModuleSettings } from '@gs/glitch-studio_shared/portable-visual-module.ts';
import type { PortableVisualModuleRequest, PortableVisualModuleResponse } from './protocol.ts';

export function registerVisualModuleElement(tagName: string, artwork: PortableVisualModule, workerSource: string) {
	// 同じ成果物を複数回読み込んでも登録済みのクラスを使う。タグは書き出しごとに一意にする。
	if (customElements.get(tagName) != null) return;
	const defaults = getPortableParameterDefaults(artwork.visualModule.paramDefs);
	const initial = validatePortableParameters(artwork.visualModule.paramDefs, artwork.initialParameters);
	validatePortableVisualModuleSettings(artwork.settings);

	class PortableVisualModuleElement extends HTMLElement {
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
		private frameId: number | null = null;
		private frameInFlight = false;
		private dirty = true;
		private resetHistory = true;
		private time = 0;
		private lastTick: number | null = null;
		private readonly frameRateLimiter = new PortableVisualModuleFrameRateLimiter();
		private pointerElementPosition: { x: number; y: number } | null = null;

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
			this.resetFrameTiming();
			this.resetHistory = true;
			if (this.failed) { this.disconnect(); this.connectedCallback(); }
			this.requestRender();
		}
		public setParameter(name: string, value: unknown) { this.setParameters({ [name]: value }); }
		public setParameters(values: Record<string, unknown>) {
			const validated = validatePortableParameters(artwork.visualModule.paramDefs, values);
			this.apiParameters = { ...this.apiParameters, ...validated };
			this.requestRender();
		}
		public getParameter(name: string): unknown {
			if (!Object.hasOwn(defaults, name)) throw new Error(`Unknown public parameter: ${name}`);
			return structuredClone(this.parameters()[name]);
		}
		public resetParameter(name: string) {
			if (!Object.hasOwn(defaults, name)) throw new Error(`Unknown public parameter: ${name}`);
			delete this.apiParameters[name];
			this.requestRender();
		}
		private parameters() { return { ...defaults, ...initial, ...this.attributeParameters, ...this.apiParameters }; }

		public attributeChangedCallback(name: string) {
			try {
				if (name === 'parameters') {
					this.attributeParameters = validatePortableParameters(artwork.visualModule.paramDefs, JSON.parse(this.getAttribute(name) ?? '{}'));
				} else if (name !== 'paused') {
					const fpsLimitAttribute = this.getAttribute('fps-limit');
					const settings: PortableVisualModuleSettings = {
						resolutionScale: Number(this.getAttribute('resolution-scale') ?? artwork.settings.resolutionScale),
						maxPixels: Number(this.getAttribute('max-pixels') ?? artwork.settings.maxPixels),
						fpsLimit: fpsLimitAttribute == null ? artwork.settings.fpsLimit : fpsLimitAttribute === 'auto' ? null : Number(fpsLimitAttribute),
					};
					validatePortableVisualModuleSettings(settings);
					this.settings = settings;
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
				this.pointerElementPosition = { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
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
				worker.addEventListener('message', (event: MessageEvent<PortableVisualModuleResponse>) => {
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
				const message: PortableVisualModuleRequest = { type: 'initialize', canvas, artwork };
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
			this.worker?.postMessage({ type: 'dispose' } satisfies PortableVisualModuleRequest);
			this.worker?.terminate();
			this.worker = null;
			if (this.workerUrl != null) URL.revokeObjectURL(this.workerUrl);
			this.workerUrl = null;
			this.readyState.reject(new Error('Visual Module disconnected'));
			this.readyForFrames = false;
			this.frameInFlight = false;
			this.visible = false;
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
				const message: PortableVisualModuleRequest = { type: 'frame', frame: {
					resolution, time: this.time, pointerElementPosition: this.pointerElementPosition, parameters: this.parameters(), resetHistory: this.resetHistory,
				} };
				this.worker!.postMessage(message);
				this.dirty = false;
				this.resetHistory = false;
				this.frameInFlight = true;
			}
			this.schedule();
		}
	}
	customElements.define(tagName, PortableVisualModuleElement);
}
