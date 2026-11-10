import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { PreviewImageAnalysis } from './preview-image-analysis.ts';
import type { PreviewImageAnalysisSettings, PreviewWaveformCanvasSizes } from '@gs/glitch-studio_shared/preview-image-analysis.ts';
import defaultVertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import finalRenderShaderCode from './render.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import { CpuPreviewCanvasContext } from './preview-canvas-context.ts';
import { CpuPreviewFrameQueue } from './cpu-preview-frame-queue.ts';
import type { CpuPreviewFrameReservation } from './cpu-preview-frame-queue.ts';
import { PreviewBackgroundScheduler } from './preview-background-scheduler.ts';
import type { PreviewCanvasContext, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';

export class CanvasRenderer {
	private gpuContext: PreviewCanvasContext;
	private readonly cpuCanvasContexts: CpuPreviewCanvasContext[];
	private readonly cpuFrameQueue: CpuPreviewFrameQueue | null;
	private readonly cpuMainCanvasContexts: readonly CpuPreviewCanvasContext[];
	private readonly cpuAnalysisCanvasContexts: readonly CpuPreviewCanvasContext[];
	private readonly canvasContexts: Partial<Record<CpuPreviewCanvasTarget, PreviewCanvasContext>>;
	public get usesCpuDisplay() { return this.cpuCanvasContexts.length > 0; }
	private gpuDevice: GPUDevice;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private latestRenderedToCanasTexture: GPUTexture | null = null;
	private readonly imageAnalysis: PreviewImageAnalysis | null;
	private highResolutionAnalysisGeneration = 0;
	public highlightClipping = false;
	public previewExposure = 0;
	public opaqueOutput = false;
	private currentPreviewBackground: 'black' | 'checker' | null = null;
	private backgroundImage: GPUTexture | null = null;
	private backgroundCopyPipeline: GPURenderPipeline | null = null;
	private readonly backgroundScheduler = new PreviewBackgroundScheduler(() => this.renderBackgroundFrame());
	private backgroundFrame: CpuPreviewFrameReservation | null = null;
	private backgroundGeneration = 0;
	private currentPreviewActive = false;
	public get previewActive() { return this.currentPreviewActive; }
	public set previewActive(value: boolean) {
		if (value === this.currentPreviewActive) return;
		this.currentPreviewActive = value;
		if (!value) this.backgroundFrame?.cancel();
		this.updateBackgroundScheduling();
	}
	public analysisValueScale: ImageValueScale = 'srgb';
	public analysisTarget: ImageAnalysisTarget = 'rgb';
	public analysisValueRange: ImageValueRange = { minimum: 0, maximum: 1 };
	public analysisWaveformCanvasSizes: PreviewWaveformCanvasSizes | null = null;
	private get imageAnalysisSettings(): PreviewImageAnalysisSettings {
		return { target: this.analysisTarget, valueScale: this.analysisValueScale, valueRange: this.analysisValueRange, waveformCanvasSizes: this.analysisWaveformCanvasSizes };
	}
	public set analysisPaused(value: boolean) { if (this.imageAnalysis != null) this.imageAnalysis.paused = value; }
	public get previewBackground() { return this.currentPreviewBackground; }
	public set previewBackground(value: 'black' | 'checker' | null) {
		if (value === this.currentPreviewBackground) return;
		this.currentPreviewBackground = value;
		if (value !== 'checker') this.clearBackgroundAnimation();
		else this.updateBackgroundScheduling();
	}

	constructor(options: {
		gpuDevice: GPUDevice;
		gpuContext: PreviewCanvasContext;
		enableWaveformAndHistogram: boolean;
		histogramGpuContext?: PreviewCanvasContext;
		waveformHorizontalGpuContext?: PreviewCanvasContext;
		waveformVerticalGpuContext?: PreviewCanvasContext;
	}) {
		this.gpuDevice = options.gpuDevice;
		this.gpuContext = options.gpuContext;
		this.canvasContexts = { canvas: options.gpuContext, histogramCanvas: options.histogramGpuContext, waveformHorizontalCanvas: options.waveformHorizontalGpuContext, waveformVerticalCanvas: options.waveformVerticalGpuContext };
		this.cpuCanvasContexts = [options.gpuContext, options.histogramGpuContext, options.waveformHorizontalGpuContext, options.waveformVerticalGpuContext]
			.filter((context): context is CpuPreviewCanvasContext => context instanceof CpuPreviewCanvasContext);
		this.cpuFrameQueue = this.cpuCanvasContexts.length > 0 ? new CpuPreviewFrameQueue(this.cpuCanvasContexts) : null;
		this.cpuMainCanvasContexts = options.gpuContext instanceof CpuPreviewCanvasContext ? [options.gpuContext] : [];
		this.cpuAnalysisCanvasContexts = this.cpuCanvasContexts.filter(context => context !== options.gpuContext);

		// 非表示にするだけでは集計パスが残る。無効時は解析用リソース自体を生成せず、
		// renderToCanvasでも通常のプレビュー描画だけを実行する。
		this.imageAnalysis = options.enableWaveformAndHistogram ? new PreviewImageAnalysis(this.gpuDevice, {
			histogram: options.histogramGpuContext, horizontal: options.waveformHorizontalGpuContext, vertical: options.waveformVerticalGpuContext,
		}) : null;

		const finalRenderShaderModule = this.gpuDevice.createShaderModule({
			code: colorSpaceShaderCode + '\n' + finalRenderShaderCode,
		});

		const finalRenderShaderDataDefinitions = makeShaderDataDefinitions(finalRenderShaderCode);

		this.finalRenderSampler = this.gpuDevice.createSampler({ minFilter: 'linear', magFilter: 'linear' });
		this.finalRenderPipeline = this.gpuDevice.createRenderPipeline({
			vertex: {
				module: this.gpuDevice.createShaderModule({
					code: defaultVertexShaderCode,
				}),
			},
			fragment: {
				module: finalRenderShaderModule,
				entryPoint: 'fs',
				targets: [{
					format: navigator.gpu.getPreferredCanvasFormat(),
				}],
			},
			primitive: {
				topology: 'triangle-list',
			},
			layout: 'auto',
		});

		this.finalRenderUniformValues = makeStructuredView(finalRenderShaderDataDefinitions.uniforms.uniforms);

		this.finalRenderUniformBuffer = this.gpuDevice.createBuffer({
			size: this.finalRenderUniformValues.arrayBuffer.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	private renderFinalImage(tex: GPUTexture, commandEncoder: GPUCommandEncoder) {
		if (this.finalRenderBindGroup == null || this.latestRenderedToCanasTexture !== tex) {
			this.latestRenderedToCanasTexture = tex;
			this.finalRenderBindGroup = this.gpuDevice.createBindGroup({
				layout: this.finalRenderPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 1, resource: { buffer: this.finalRenderUniformBuffer } },
					{ binding: 3, resource: this.finalRenderSampler },
					{ binding: 2, resource: tex.createView() }, // TODO: cache view
				],
			});
		}

		this.finalRenderUniformValues.set({
			highlightClipping: this.highlightClipping ? 1 : 0,
			previewExposure: this.previewExposure,
			opaqueOutput: this.opaqueOutput ? 1 : 0,
			previewBackground: this.previewBackground === 'checker' ? 2 : this.previewBackground === 'black' ? 1 : 0,
			backgroundPhase: this.previewBackground === 'checker' ? (performance.now() / 700) % 1 : 0,
		});
		this.gpuDevice.queue.writeBuffer(this.finalRenderUniformBuffer, 0, this.finalRenderUniformValues.arrayBuffer);

		const passEncoder = commandEncoder.beginRenderPass({
			colorAttachments: [{
				view: this.gpuContext.getCurrentTexture().createView(),
				clearValue: {
					r: 0.0,
					g: 0.0,
					b: 0.0,
					a: 1.0,
				},
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		passEncoder.setPipeline(this.finalRenderPipeline);
		passEncoder.setBindGroup(0, this.finalRenderBindGroup);
		passEncoder.draw(3);
		passEncoder.end();
	}

	public renderToCanvas(tex: GPUTexture, commandEncoder: GPUCommandEncoder) {
		if (this.previewActive && this.previewBackground === 'checker') this.captureBackgroundImage(tex, commandEncoder);
		this.renderFinalImage(tex, commandEncoder);
		this.imageAnalysis?.renderLive(tex, commandEncoder, this.imageAnalysisSettings);
		this.backgroundScheduler.notifyFrameRendered();
	}

	private captureBackgroundImage(tex: GPUTexture, encoder: GPUCommandEncoder) {
		if (this.backgroundImage == null || this.backgroundImage.width !== tex.width || this.backgroundImage.height !== tex.height) {
			this.backgroundImage?.destroy();
			this.backgroundImage = this.gpuDevice.createTexture({ size: [tex.width, tex.height], format: INTERMEDIATE_TEXTURE_FORMAT,
				usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
		}
		this.backgroundCopyPipeline ??= this.gpuDevice.createRenderPipeline({ layout: 'auto',
			vertex: { module: this.gpuDevice.createShaderModule({ code: defaultVertexShaderCode }) },
			fragment: { module: this.gpuDevice.createShaderModule({ code: colorSpaceShaderCode + '\n' + finalRenderShaderCode }),
				entryPoint: 'copyLinearImage', targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }] },
			primitive: { topology: 'triangle-list' },
		});
		const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.backgroundImage.createView(), loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(this.backgroundCopyPipeline);
		pass.setBindGroup(0, this.gpuDevice.createBindGroup({ layout: this.backgroundCopyPipeline.getBindGroupLayout(0), entries: [{ binding: 2, resource: tex.createView() }] }));
		pass.draw(3);
		pass.end();
		// 停止中も背景だけを動かす。借用中の作業画像を保持すると編集で破棄され得るため、
		// 自前のlinear画像を使い、ノード・履歴・解析は再評価しない。CPU表示の上限も共用する。
		this.updateBackgroundScheduling();
	}

	private updateBackgroundScheduling() {
		this.backgroundScheduler.setEnabled(this.previewActive && this.previewBackground === 'checker' && this.backgroundImage != null);
	}

	private async renderBackgroundFrame() {
		if (!this.previewActive || this.backgroundImage == null) return;
		const frame = this.cpuMainCanvasContexts.length > 0 ? this.cpuFrameQueue!.tryReserveFrame(this.cpuMainCanvasContexts) : null;
		if (this.cpuMainCanvasContexts.length > 0 && frame == null) return;
		const generation = this.backgroundGeneration;
		this.backgroundFrame = frame;
		try {
			const encoder = this.gpuDevice.createCommandEncoder();
			this.renderFinalImage(this.backgroundImage, encoder);
			frame?.prepareReadback(encoder);
			this.gpuDevice.queue.submit([encoder.finish()]);
			// GPUが詰まっても背景の描画要求を積み増さない。
			await (frame?.complete() ?? this.gpuDevice.queue.onSubmittedWorkDone());
		} catch (error) {
			frame?.cancel();
			if (generation === this.backgroundGeneration) this.clearBackgroundAnimation();
			throw error;
		} finally {
			if (this.backgroundFrame === frame) this.backgroundFrame = null;
		}
	}

	private clearBackgroundAnimation() {
		this.backgroundScheduler.setEnabled(false);
		this.backgroundFrame?.cancel();
		this.backgroundFrame = null;
		this.backgroundImage?.destroy();
		this.backgroundImage = null;
		this.backgroundGeneration++;
	}

	public clear() {
		this.imageAnalysis?.forgetSource();
		this.clearBackgroundAnimation();
		this.cpuFrameQueue?.clear();
		for (const context of this.cpuCanvasContexts) context.invalidatePendingFrames();
		this.finalRenderBindGroup = null;
		this.latestRenderedToCanasTexture = null;
	}

	public tryReserveCpuPreviewFrame() { return this.cpuFrameQueue?.tryReserveFrame(this.imageAnalysis?.livePaused === true ? this.cpuMainCanvasContexts : this.cpuCanvasContexts) ?? null; }

	public async reserveCpuPreviewFrame() { return this.cpuFrameQueue?.reserveFrame(this.imageAnalysis?.livePaused === true ? this.cpuMainCanvasContexts : this.cpuCanvasContexts) ?? null; }

	/** リサイズでは作品を再評価せず、最後に完成した画像の解析だけを描き直す。 */
	public async refreshImageAnalysis() {
		const analysis = this.imageAnalysis;
		if (analysis == null || analysis.livePaused) return;
		const frame = this.cpuAnalysisCanvasContexts.length > 0 ? await this.cpuFrameQueue!.reserveFrame(this.cpuAnalysisCanvasContexts) : null;
		try {
			const encoder = this.gpuDevice.createCommandEncoder();
			if (!analysis.renderCurrent(encoder, this.imageAnalysisSettings)) { frame?.cancel(); return; }
			frame?.prepareReadback(encoder);
			this.gpuDevice.queue.submit([encoder.finish()]);
			await (frame?.complete() ?? this.gpuDevice.queue.onSubmittedWorkDone());
		} catch (error) { frame?.cancel(); throw error; }
	}

	public async setHighResolutionImageAnalysis(enabled: boolean, settings: PreviewImageAnalysisSettings): Promise<boolean> {
		const analysis = this.imageAnalysis;
		if (analysis == null) return false;
		if (!enabled) {
			this.highResolutionAnalysisGeneration++;
			analysis.releaseSnapshot();
			for (const context of this.cpuAnalysisCanvasContexts) context.invalidatePendingFrames();
			return true;
		}
		if (!analysis.hasSnapshot) {
			// CPU表示の空きを待つ前に元フレームを確定し、後続の動画フレームで置き換えない。
			const encoder = this.gpuDevice.createCommandEncoder();
			if (!analysis.capture(encoder)) return false;
			this.gpuDevice.queue.submit([encoder.finish()]);
			for (const context of this.cpuAnalysisCanvasContexts) context.invalidatePendingFrames();
		}
		const generation = this.highResolutionAnalysisGeneration;
		while (generation === this.highResolutionAnalysisGeneration && analysis.hasSnapshot) {
			const frame = this.cpuAnalysisCanvasContexts.length > 0 ? await this.cpuFrameQueue!.reserveFrame(this.cpuAnalysisCanvasContexts) : null;
			if (generation !== this.highResolutionAnalysisGeneration || !analysis.hasSnapshot) { frame?.cancel(); return false; }
			try {
				const encoder = this.gpuDevice.createCommandEncoder();
				analysis.renderSnapshot(encoder, settings);
				frame?.prepareReadback(encoder);
				this.gpuDevice.queue.submit([encoder.finish()]);
				await (frame?.complete() ?? this.gpuDevice.queue.onSubmittedWorkDone());
				if (frame?.isCancelled === true) continue;
				return generation === this.highResolutionAnalysisGeneration && analysis.hasSnapshot;
			} catch (error) { frame?.cancel(); throw error; }
		}
		return false;
	}

	public recycleCpuPreviewPixels(target: CpuPreviewCanvasTarget, frameId: number, pixels: ArrayBuffer) {
		const context = this.canvasContexts[target];
		if (context instanceof CpuPreviewCanvasContext) context.recyclePixels(frameId, pixels);
	}

	public destroy() {
		this.highResolutionAnalysisGeneration++;
		this.imageAnalysis?.dispose();
		this.clearBackgroundAnimation();
		this.cpuFrameQueue?.destroy();
		for (const context of this.cpuCanvasContexts) context.unconfigure();
	}
}
