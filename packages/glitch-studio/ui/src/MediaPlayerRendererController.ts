import { ref } from 'vue';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { PreviewImageAnalysisDisplaySettings, PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { createMediaPlayerRendererWorker } from '@gs/glitch-studio_renderer/client.ts';
import type { MediaPlayerRenderer, MediaPlayerRendererOptions, MediaPlayerPreviewOptions } from '@gs/glitch-studio_renderer/media-player-renderer.ts';
import { RendererManagerControllerBase } from './RendererManagerControllerBase.ts';
import { displayCpuPreviewFrame } from './utility/cpu-preview-display.ts';

type VideoFrameRequest = { frame: VideoFrame; resolution: Resolution };
type RenderSession = { pendingFrame: VideoFrameRequest | null; sendingFrame: boolean };
const canvasNames = ['canvas', 'histogramCanvas', 'waveformHorizontalCanvas', 'waveformVerticalCanvas'] as const;

function createCanvas(name: typeof canvasNames[number]) {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	canvas.style.display = 'block';
	if (name === 'canvas') {
		canvas.style.imageRendering = 'pixelated';
	} else {
		if (name === 'histogramCanvas') {
			canvas.width = 256;
			canvas.height = 150;
		}
		canvas.style.width = '100%';
		canvas.style.height = '100%';
	}
	return canvas;
}

export class MediaPlayerRendererController extends RendererManagerControllerBase<MediaPlayerRenderer> {
	public canvas: HTMLCanvasElement | null = null;
	public histogramCanvas: HTMLCanvasElement | null = null;
	public waveformHorizontalCanvas: HTMLCanvasElement | null = null;
	public waveformVerticalCanvas: HTMLCanvasElement | null = null;
	public readonly canvasRevision = ref(0);
	public readonly outputResolution = ref<Resolution | null>(null);
	public readonly errorMessage = ref<string | null>(null);
	private renderSession: RenderSession | null = null;

	constructor() {
		super({
			createWorker: createMediaPlayerRendererWorker,
			onCreated: () => {},
			onDisposed: () => {},
			onError: error => {
				if (error != null) this.stop();
				this.errorMessage.value = error?.message ?? null;
			},
			eventHandlers: {
				cpuPreviewFrame: frame => {
					try {
						const canvas = this[frame.target];
						if (canvas != null) displayCpuPreviewFrame(canvas, frame);
					} catch (error) {
						this.reportRenderFailure(error instanceof Error ? error : new Error(String(error)));
					} finally {
						if (this.isReady.value) this.call('recycleCpuPreviewPixels', [frame.target, frame.frameId, frame.pixels], [frame.pixels]);
					}
				},
				renderError: ({ message }) => this.reportRenderFailure(new Error(message)),
			},
		});
	}

	public async start(options: Omit<MediaPlayerRendererOptions, 'canvases'>) {
		this.renderSession = { pendingFrame: null, sendingFrame: false };
		this.errorMessage.value = null;
		await this.launchManager(() => {
			const canvases = Object.fromEntries(canvasNames.map(name => {
				const canvas = this[name] = createCanvas(name);
				return [name, options.displayMode === 'cpu'
					? new OffscreenCanvas(canvas.width, canvas.height) : canvas.transferControlToOffscreen()];
			})) as MediaPlayerRendererOptions['canvases'];
			this.canvasRevision.value++;
			return { options: { rendererOptions: { ...options, preview: deepClone(options.preview), canvases } }, transfer: Object.values(canvases) };
		});
	}

	public stop() {
		if (this.renderSession == null) return;
		this.renderSession.pendingFrame?.frame.close();
		this.renderSession = null;
		this.disposeManager();
		this.outputResolution.value = null;
		for (const name of canvasNames) this[name] = null;
		this.canvasRevision.value++;
	}

	public async showImage(file: FileSource) {
		const renderSession = this.renderSession;
		const resolution = await this.callAndWaitReturn('showImage', [file instanceof Blob ? file : { ...file }]);
		if (this.renderSession === renderSession) this.setResolution(resolution);
	}

	public showVideoFrame(frame: VideoFrame, resolution: Resolution) {
		const renderSession = this.renderSession;
		if (!this.isReady.value || renderSession == null) {
			frame.close();
			return;
		}
		// デコードがGPUやCPU表示の読み戻しより速いときは、転送待ちの最新フレームだけを保持する。
		renderSession.pendingFrame?.frame.close();
		renderSession.pendingFrame = { frame, resolution };
		if (!renderSession.sendingFrame) void this.sendFrames(renderSession);
	}

	public async updateOptions(options: MediaPlayerPreviewOptions) {
		if (this.isReady.value) await this.callAndWaitReturn('updateOptions', [deepClone(options)]);
	}

	public async setImageAnalysisDisplay(settings: PreviewImageAnalysisDisplaySettings) {
		if (this.isReady.value) await this.callAndWaitReturn('setImageAnalysisDisplay', [deepClone(settings)]);
	}

	public async setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings) {
		if (!this.isReady.value) return false;
		return this.callAndWaitReturn('setHighResolutionImageAnalysis', [enabled, deepClone(settings)]);
	}

	private setResolution(resolution: Resolution) {
		const previous = this.outputResolution.value;
		const canvas = this.canvas;
		if (canvas == null || (resolution.width === previous?.width && resolution.height === previous.height)) return;
		canvas.style.width = resolution.width + 'px';
		canvas.style.height = resolution.height + 'px';
		this.outputResolution.value = resolution;
	}

	private async sendFrames(renderSession: RenderSession) {
		renderSession.sendingFrame = true;
		try {
			while (this.renderSession === renderSession && renderSession.pendingFrame != null) {
				const { frame, resolution } = renderSession.pendingFrame;
				renderSession.pendingFrame = null;
				try {
					await this.callAndWaitReturn('showVideoFrame', [frame, resolution], [frame]);
					if (this.renderSession === renderSession) this.setResolution(resolution);
				} finally {
					// postMessageが失敗した場合も、送信側に残ったフレームを解放する。
					frame.close();
				}
			}
		} catch (error) {
			if (this.renderSession === renderSession) this.reportRenderFailure(error instanceof Error ? error : new Error(String(error)));
		} finally {
			renderSession.sendingFrame = false;
		}
	}
}
