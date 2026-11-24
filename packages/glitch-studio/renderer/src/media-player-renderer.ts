import { EventEmitter } from 'eventemitter3';
import { readFileSource, type FileSource } from '@gs/shared/file-source.ts';
import { createExternalImageToLinearTextureConverter } from '@gs/shared/media/external-image-texture.ts';
import { createVideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import type { PreviewImageAnalysisDisplaySettings, PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { CanvasRenderer } from './canvas-renderer.ts';
import { createCanvasOutputConfigurator, createGpuPreviewCanvasOutputSettings, createSrgbCanvasOutputSettings } from './canvas-output.ts';
import { createPreviewCanvasContext } from './preview-canvas-context.ts';
import type { CpuPreviewCanvasTarget, CpuPreviewFrame, PreviewDisplayMode } from './preview-canvas-context.ts';

export type MediaPlayerPreviewOptions = Pick<CanvasRenderer,
	'highlightClipping' | 'previewWarningImageSource' | 'previewGamutWarning' | 'previewExposure' |
	'previewSrgbProof' | 'previewGamutCompression' | 'previewBackground' | 'analysisTarget' |
	'analysisValueScale' | 'analysisValueRange' | 'analysisImageSource' | 'analysisPaused' |
	'analysisWaveformCanvasSizes' | 'analysisWaveformViewports' | 'analysisHistogramViewport'>;

export type MediaPlayerRendererOptions = {
	canvases: Record<CpuPreviewCanvasTarget, OffscreenCanvas>;
	displayMode: PreviewDisplayMode;
	analysisEnabled: boolean;
	preview: MediaPlayerPreviewOptions;
};

export type MediaPlayerRendererEvents =
	| { type: 'cpuPreviewFrame'; ctx: CpuPreviewFrame }
	| { type: 'renderError'; ctx: { message: string } };

/** Media Playerで開いた一つの映像ソースを表示する。再生時計はUIのメディア要素が所有する。 */
export class MediaPlayerRenderer extends EventEmitter<{ ev: [MediaPlayerRendererEvents] }> {
	private readonly canvasRenderer: CanvasRenderer;
	private readonly canvas: OffscreenCanvas;
	private readonly configureCanvas: (alphaMode: GPUCanvasAlphaMode) => void;
	private videoTexture: ReturnType<typeof createVideoFrameTexture> | null = null;
	private imageTexture: GPUTexture | null = null;
	private currentFrame: { texture: GPUTexture; resolution: Resolution } | null = null;

	private constructor(private readonly device: GPUDevice, options: MediaPlayerRendererOptions) {
		super();
		const { displayMode, canvases } = options;
		this.canvas = canvases.canvas;
		const canvasOutput = displayMode === 'gpu' ? createGpuPreviewCanvasOutputSettings() : createSrgbCanvasOutputSettings();
		const createContext = (target: CpuPreviewCanvasTarget) => createPreviewCanvasContext(canvases[target], displayMode,
			frame => this.emit('ev', { type: 'cpuPreviewFrame', ctx: { ...frame, target } }));
		const gpuContext = createContext('canvas');
		this.configureCanvas = createCanvasOutputConfigurator(device, gpuContext, canvasOutput);
		this.canvasRenderer = new CanvasRenderer({
			gpuDevice: device,
			gpuContext,
			canvasOutput,
			enableWaveformAndHistogram: options.analysisEnabled,
			histogramGpuContext: options.analysisEnabled ? createContext('histogramCanvas') : undefined,
			waveformHorizontalGpuContext: options.analysisEnabled ? createContext('waveformHorizontalCanvas') : undefined,
			waveformVerticalGpuContext: options.analysisEnabled ? createContext('waveformVerticalCanvas') : undefined,
		});
		this.canvasRenderer.previewActive = true;
		this.applyOptions(options.preview);
		device.addEventListener('uncapturederror', event => this.reportError(event.error.message));
		void device.lost.then(info => { if (info.reason !== 'destroyed') this.reportError(info.message); });
	}

	public static async create(options: MediaPlayerRendererOptions) {
		const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
		if (adapter == null) throw new Error('Media Player requires WebGPU');
		const device = await adapter.requestDevice();
		try {
			return new MediaPlayerRenderer(device, options);
		} catch (error) {
			device.destroy();
			throw error;
		}
	}

	public async showImage(file: FileSource): Promise<Resolution> {
		const bitmap = await createImageBitmap(await readFileSource(file));
		try {
			const resolution = { width: bitmap.width, height: bitmap.height };
			this.imageTexture = this.device.createTexture({
				size: [resolution.width, resolution.height],
				format: INTERMEDIATE_TEXTURE_FORMAT,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
			const converter = createExternalImageToLinearTextureConverter(this.device);
			try { converter.copy(bitmap, this.imageTexture); } finally { converter.dispose(); }
			this.currentFrame = { texture: this.imageTexture, resolution };
			await this.render();
			return resolution;
		} finally {
			bitmap.close();
		}
	}

	public async showVideoFrame(frame: VideoFrame, resolution: Resolution) {
		try {
			this.videoTexture ??= createVideoFrameTexture(this.device);
			this.currentFrame = { texture: this.videoTexture.upload(frame), resolution };
		} finally {
			frame.close();
		}
		await this.render();
	}

	public async updateOptions(options: MediaPlayerPreviewOptions) {
		this.applyOptions(options);
		await this.render();
	}

	public async setImageAnalysisDisplay(settings: PreviewImageAnalysisDisplaySettings) {
		this.canvasRenderer.analysisWaveformCanvasSizes = settings.waveformCanvasSizes;
		this.canvasRenderer.analysisWaveformViewports = settings.waveformViewports;
		this.canvasRenderer.analysisHistogramViewport = settings.histogramViewport;
		await this.canvasRenderer.refreshImageAnalysis();
	}

	public setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings) {
		return this.canvasRenderer.setHighResolutionImageAnalysis(enabled, settings);
	}

	public recycleCpuPreviewPixels(target: CpuPreviewCanvasTarget, frameId: number, pixels: ArrayBuffer) {
		this.canvasRenderer.recycleCpuPreviewPixels(target, frameId, pixels);
	}

	public destroy() {
		this.canvasRenderer.destroy();
		this.videoTexture?.dispose();
		this.imageTexture?.destroy();
		this.device.destroy();
	}

	private applyOptions(options: MediaPlayerPreviewOptions) {
		Object.assign(this.canvasRenderer, options);
		this.configureCanvas(options.previewBackground == null ? 'premultiplied' : 'opaque');
	}

	private async render() {
		if (this.currentFrame == null) return;
		const cpuFrame = await this.canvasRenderer.reserveCpuPreviewFrame();
		const { texture, resolution } = this.currentFrame;
		try {
			const canvas = this.canvas;
			if (canvas.width !== resolution.width) canvas.width = resolution.width;
			if (canvas.height !== resolution.height) canvas.height = resolution.height;
			const encoder = this.device.createCommandEncoder();
			this.canvasRenderer.renderToCanvas(texture, encoder);
			cpuFrame?.prepareReadback(encoder);
			this.device.queue.submit([encoder.finish()]);
			await (cpuFrame?.complete() ?? this.device.queue.onSubmittedWorkDone());
		} catch (error) {
			cpuFrame?.cancel();
			throw error;
		}
	}

	private reportError(message: string) {
		this.emit('ev', { type: 'renderError', ctx: { message } });
	}
}
