import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import defaultVertexShaderCode from '@gs/shared/gpu/vertex.wgsl?raw';
import finalRenderShaderCode from './render.wgsl?raw';
import { CpuPreviewCanvasContext } from './preview-canvas-context.ts';
import type { PreviewCanvasContext, CpuPreviewCanvasTarget } from './preview-canvas-context.ts';

export class CanvasRenderer {
	private gpuContext: PreviewCanvasContext;
	private readonly cpuCanvasContexts: CpuPreviewCanvasContext[];
	private readonly canvasContexts: Partial<Record<CpuPreviewCanvasTarget, PreviewCanvasContext>>;
	public get usesCpuDisplay() { return this.cpuCanvasContexts.length > 0; }
	private gpuDevice: GPUDevice;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private latestRenderedToCanasTexture: GPUTexture | null = null;
	private gpuHistogram: GpuHistogram | null = null;
	private gpuWaveformHorizontal: GpuWaveform | null = null;
	private gpuWaveformVertical: GpuWaveform | null = null;
	public highlightClipping = false;
	public opaqueOutput = false;

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

		// 非表示にするだけでは集計パスが残る。無効時は解析用リソース自体を生成せず、
		// renderToCanvasでも通常のプレビュー描画だけを実行する。
		if (options.enableWaveformAndHistogram && options.histogramGpuContext != null) this.gpuHistogram = new GpuHistogram(
			this.gpuDevice,
			options.histogramGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);
		if (options.enableWaveformAndHistogram && options.waveformHorizontalGpuContext != null) this.gpuWaveformHorizontal = new GpuWaveform(
			this.gpuDevice,
			options.waveformHorizontalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);

		if (options.enableWaveformAndHistogram && options.waveformVerticalGpuContext != null) this.gpuWaveformVertical = new GpuWaveform(
			this.gpuDevice,
			options.waveformVerticalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
			'y',
		);

		const finalRenderShaderModule = this.gpuDevice.createShaderModule({
			code: finalRenderShaderCode,
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

	public renderToCanvas(tex: GPUTexture, commandEncoder: GPUCommandEncoder) {
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
			opaqueOutput: this.opaqueOutput ? 1 : 0,
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
		passEncoder.draw(6);
		passEncoder.end();

		this.gpuHistogram?.render(commandEncoder, tex);
		this.gpuWaveformHorizontal?.render(commandEncoder, tex);
		this.gpuWaveformVertical?.render(commandEncoder, tex);
	}

	public clear() {
		for (const context of this.cpuCanvasContexts) context.invalidatePendingFrames();
		this.finalRenderBindGroup = null;
		this.latestRenderedToCanasTexture = null;
	}

	public async waitForCpuDisplayCapacity() {
		await Promise.all(this.cpuCanvasContexts.map(context => context.waitForReadbackCapacity()));
	}

	/** 解析用Canvasも同じ経路で表示し、CPU表示時だけ解析を省く条件差を作らない。 */
	public presentCpuFrame(): Promise<void> | null {
		if (!this.usesCpuDisplay) return null;
		const encoder = this.gpuDevice.createCommandEncoder({ label: 'CPU preview readback' });
		const completions = this.cpuCanvasContexts.flatMap(context => {
			const complete = context.prepareReadback(encoder);
			return complete == null ? [] : [complete];
		});
		if (completions.length === 0) return null;
		this.gpuDevice.queue.submit([encoder.finish()]);
		return Promise.all(completions.map(complete => complete())).then(() => {});
	}

	public recycleCpuPreviewPixels(target: CpuPreviewCanvasTarget, frameId: number, pixels: ArrayBuffer) {
		const context = this.canvasContexts[target];
		if (context instanceof CpuPreviewCanvasContext) context.recyclePixels(frameId, pixels);
	}

	public destroy() {
		this.gpuHistogram?.dispose();
		this.gpuWaveformHorizontal?.dispose();
		this.gpuWaveformVertical?.dispose();
		for (const context of this.cpuCanvasContexts) context.unconfigure();
	}
}
