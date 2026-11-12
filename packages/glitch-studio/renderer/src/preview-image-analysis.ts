import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { copyPreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import { FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';
import { DEFAULT_IMAGE_VALUE_RANGE } from '@gs/shared/utility/image-value-scale.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { PreviewCanvasContext } from './preview-canvas-context.ts';
import { PreviewAnalysisImageTransform } from './preview-analysis-image-transform.ts';
import type { PreviewGamutCompressionResources } from './preview-gamut-compression-resources.ts';

/** 解析対象（RGB・Alpha等）とは別の、今回描き直すモニター。 */
export type PreviewImageAnalysisMonitors = { histogram: boolean; horizontal: boolean; vertical: boolean };

/** 解析Canvasと保持フレームを所有する。作品の描画・時刻・再生状態は所有しない。 */
export class PreviewImageAnalysis {
	public paused = false;
	private source: GPUTexture | null = null;
	private snapshot: GPUTexture | null = null;
	private renderedSource: GPUTexture | null = null;
	private renderedSettings: PreviewImageAnalysisSettings | null = null;
	private renderedAtFullResolution = false;
	private invalidatedMonitors: PreviewImageAnalysisMonitors = { histogram: false, horizontal: false, vertical: false };
	private readonly histogram: GpuHistogram | null;
	private readonly horizontal: GpuWaveform | null;
	private readonly vertical: GpuWaveform | null;
	private readonly imageTransform: PreviewAnalysisImageTransform;
	private readonly copyPipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
	private readonly copyLayout: GPUBindGroupLayout;
	public get hasSnapshot() { return this.snapshot != null; }
	public get livePaused() { return this.paused || this.hasSnapshot; }

	constructor(private readonly device: GPUDevice, contexts: { histogram?: PreviewCanvasContext; horizontal?: PreviewCanvasContext; vertical?: PreviewCanvasContext }, gamutResources: PreviewGamutCompressionResources) {
		const format = navigator.gpu.getPreferredCanvasFormat();
		this.imageTransform = new PreviewAnalysisImageTransform(device, gamutResources);
		this.histogram = contexts.histogram == null ? null : new GpuHistogram(device, contexts.histogram, format, this.imageTransform);
		this.horizontal = contexts.horizontal == null ? null : new GpuWaveform(device, contexts.horizontal, format, 'x', this.imageTransform);
		this.vertical = contexts.vertical == null ? null : new GpuWaveform(device, contexts.vertical, format, 'y', this.imageTransform);
		this.copyLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
	}

	public renderLive(source: GPUTexture, encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings) {
		this.source = source;
		// 同じGPUTextureを動画などが書き換えることがある。通常フレームでは設定が同じでも
		// 必ず全モニターを更新し、表示操作からの明示的な再解析だけを差分で処理する。
		if (!this.livePaused) this.render(source, encoder, settings, false, true);
	}

	public renderCurrent(encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings): PreviewImageAnalysisMonitors | null {
		if (this.source == null || this.livePaused) return null;
		return this.render(this.source, encoder, settings, false);
	}

	public capture(encoder: GPUCommandEncoder): boolean {
		if (this.snapshot != null) return true;
		const source = this.source;
		if (source == null) return false;
		// COPY_SRCを持たないエフェクト出力も読めるよう描画で複製する。元のR/RG/RGBAとfloat精度を維持する。
		const snapshot = this.device.createTexture({ label: 'High-res analysis snapshot', size: [source.width, source.height], format: source.format,
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		let pipeline = this.copyPipelines.get(source.format);
		if (pipeline == null) {
			pipeline = this.device.createRenderPipeline({ layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.copyLayout] }),
				vertex: { module: this.device.createShaderModule({ code: vertexCode }) }, fragment: {
					module: this.device.createShaderModule({ code: `
@group(0) @binding(0) var source: texture_2d<f32>;
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
	// コピーでも近傍の数値を混ぜず、表示用の色変換を通さない。
	return textureLoad(source, vec2i(position.xy), 0);
}` }), targets: [{ format: source.format }] }, primitive: { topology: 'triangle-list' } });
			this.copyPipelines.set(source.format, pipeline);
		}
		const pass = encoder.beginRenderPass({ label: 'capture High-res analysis frame', colorAttachments: [{ view: snapshot.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, this.device.createBindGroup({ layout: this.copyLayout, entries: [{ binding: 0, resource: source.createView() }] }));
		pass.draw(3);
		pass.end();
		this.snapshot = snapshot;
		return true;
	}

	public renderSnapshot(encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings): PreviewImageAnalysisMonitors | null {
		return this.snapshot == null ? null : this.render(this.snapshot, encoder, settings, true);
	}

	private getUpdatedMonitors(source: GPUTexture, settings: PreviewImageAnalysisSettings, fullResolution: boolean, forceAll: boolean): PreviewImageAnalysisMonitors {
		const previous = this.renderedSettings;
		const commonChanged = forceAll || previous == null || this.renderedSource !== source || this.renderedAtFullResolution !== fullResolution
			|| previous.target !== settings.target || previous.valueScale !== settings.valueScale || previous.imageSource !== settings.imageSource
			|| !deepEqual(previous.valueRange, settings.valueRange)
			// 元画像の解析には露出等を適用しないので、表示調整の変更だけで全体を再集計しない。
			|| (settings.target === 'rgb' && settings.imageSource === 'previewAdjusted' && !deepEqual(previous.imageAdjustments, settings.imageAdjustments));
		return {
			histogram: this.histogram != null && (commonChanged || this.invalidatedMonitors.histogram
				|| !deepEqual(previous?.histogramViewport ?? DEFAULT_IMAGE_VALUE_RANGE, settings.histogramViewport ?? DEFAULT_IMAGE_VALUE_RANGE)),
			horizontal: this.horizontal != null && (commonChanged || this.invalidatedMonitors.horizontal
				|| !deepEqual(previous?.waveformCanvasSizes?.horizontal, settings.waveformCanvasSizes?.horizontal)
				|| !deepEqual(previous?.waveformViewports?.horizontal ?? FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT, settings.waveformViewports?.horizontal ?? FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT)),
			vertical: this.vertical != null && (commonChanged || this.invalidatedMonitors.vertical
				|| !deepEqual(previous?.waveformCanvasSizes?.vertical, settings.waveformCanvasSizes?.vertical)
				|| !deepEqual(previous?.waveformViewports?.vertical ?? FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT, settings.waveformViewports?.vertical ?? FULL_PREVIEW_IMAGE_ANALYSIS_VIEWPORT)),
		};
	}

	private render(source: GPUTexture, encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings, fullResolution: boolean, forceAll = false): PreviewImageAnalysisMonitors | null {
		const monitors = this.getUpdatedMonitors(source, settings, fullResolution, forceAll);
		if (!monitors.histogram && !monitors.horizontal && !monitors.vertical) return null;
		// 数値データには表示補正を適用しない。保持画像も元の精度のまま、集計する時点だけ変換する。
		this.imageTransform.update(settings.target === 'rgb' && settings.imageSource === 'previewAdjusted' ? settings.imageAdjustments : null);
		if (settings.waveformCanvasSizes != null) {
			if (monitors.horizontal) this.horizontal?.resize(settings.waveformCanvasSizes.horizontal);
			if (monitors.vertical) this.vertical?.resize(settings.waveformCanvasSizes.vertical);
		}
		if (monitors.histogram && this.histogram != null) {
			this.histogram.target = settings.target;
			this.histogram.valueScale = settings.valueScale;
			this.histogram.valueRange = settings.valueRange;
			this.histogram.render(encoder, source, fullResolution, settings.histogramViewport ?? undefined);
		}
		if (monitors.horizontal) this.horizontal?.render(encoder, source, settings.valueScale, settings.target, settings.valueRange, fullResolution, settings.waveformViewports?.horizontal);
		if (monitors.vertical) this.vertical?.render(encoder, source, settings.valueScale, settings.target, settings.valueRange, fullResolution, settings.waveformViewports?.vertical);
		this.renderedSource = source;
		this.renderedAtFullResolution = fullResolution;
		this.renderedSettings = copyPreviewImageAnalysisSettings(settings);
		this.invalidatedMonitors = { histogram: false, horizontal: false, vertical: false };
		return monitors;
	}

	/** CPU転送の取消し・描画失敗では、GPUへ送った設定を表示済みとして再利用しない。 */
	public invalidateMonitors(monitors: PreviewImageAnalysisMonitors) {
		this.invalidatedMonitors = {
			histogram: this.invalidatedMonitors.histogram || monitors.histogram,
			horizontal: this.invalidatedMonitors.horizontal || monitors.horizontal,
			vertical: this.invalidatedMonitors.vertical || monitors.vertical,
		};
	}

	public forgetSource() {
		this.source = null;
		if (this.renderedSource !== this.snapshot) { this.renderedSource = null; this.renderedSettings = null; }
	}

	public releaseSnapshot() {
		if (this.renderedSource === this.snapshot) { this.renderedSource = null; this.renderedSettings = null; }
		this.snapshot?.destroy();
		this.snapshot = null;
	}
	public dispose() {
		this.releaseSnapshot();
		this.forgetSource();
		this.histogram?.dispose();
		this.horizontal?.dispose();
		this.vertical?.dispose();
		this.imageTransform.dispose();
	}
}
