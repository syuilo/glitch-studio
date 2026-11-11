import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import vertexCode from '@gs/shared/gpu/vertex.wgsl?raw';
import type { PreviewImageAnalysisSettings } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import type { PreviewCanvasContext } from './preview-canvas-context.ts';
import { PreviewAnalysisImageTransform } from './preview-analysis-image-transform.ts';
import type { PreviewGamutCompressionResources } from './preview-gamut-compression-resources.ts';

/** 解析Canvasと保持フレームを所有する。作品の描画・時刻・再生状態は所有しない。 */
export class PreviewImageAnalysis {
	public paused = false;
	private source: GPUTexture | null = null;
	private snapshot: GPUTexture | null = null;
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
		if (!this.livePaused) this.render(source, encoder, settings, false);
	}

	public renderCurrent(encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings): boolean {
		if (this.source == null || this.livePaused) return false;
		this.render(this.source, encoder, settings, false);
		return true;
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

	public renderSnapshot(encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings) {
		if (this.snapshot != null) this.render(this.snapshot, encoder, settings, true);
	}

	private render(source: GPUTexture, encoder: GPUCommandEncoder, settings: PreviewImageAnalysisSettings, fullResolution: boolean) {
		// 数値データには表示補正を適用しない。保持画像も元の精度のまま、集計する時点だけ変換する。
		this.imageTransform.update(settings.target === 'rgb' && settings.imageSource === 'previewAdjusted' ? settings.imageAdjustments : null);
		if (settings.waveformCanvasSizes != null) {
			this.horizontal?.resize(settings.waveformCanvasSizes.horizontal);
			this.vertical?.resize(settings.waveformCanvasSizes.vertical);
		}
		if (this.histogram != null) {
			this.histogram.target = settings.target;
			this.histogram.valueScale = settings.valueScale;
			this.histogram.valueRange = settings.valueRange;
			this.histogram.render(encoder, source, fullResolution);
		}
		this.horizontal?.render(encoder, source, settings.valueScale, settings.target, settings.valueRange, fullResolution, settings.waveformViewports?.horizontal);
		this.vertical?.render(encoder, source, settings.valueScale, settings.target, settings.valueRange, fullResolution, settings.waveformViewports?.vertical);
	}

	public forgetSource() { this.source = null; }
	public releaseSnapshot() { this.snapshot?.destroy(); this.snapshot = null; }
	public dispose() {
		this.releaseSnapshot();
		this.forgetSource();
		this.histogram?.dispose();
		this.horizontal?.dispose();
		this.vertical?.dispose();
		this.imageTransform.dispose();
	}
}
