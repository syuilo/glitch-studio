import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { GpuHistogram } from './utility/histogram/GpuHistogram.ts';
import { GpuWaveform } from './utility/waveform/GpuWaveform.ts';
import defaultVertexShaderCode from './vertex.wgsl?raw';
import finalRenderShaderCode from './render.wgsl?raw';

export class CanvasRenderer {
	private gpuContext: GPUCanvasContext;
	private gpuDevice: GPUDevice;
	private finalRenderUniformValues: ReturnType<typeof makeStructuredView>;
	private finalRenderSampler: GPUSampler;
	private finalRenderPipeline: GPURenderPipeline;
	private finalRenderUniformBuffer: GPUBuffer;
	private finalRenderBindGroup: GPUBindGroup | null = null;
	private latestRenderedToCanasTexture: GPUTexture | null = null;
	private gpuHistogram?: GpuHistogram;
	private gpuWaveformHorizontal?: GpuWaveform;
	private gpuWaveformVertical?: GpuWaveform;
	public highlightClipping = false;
	public opaqueOutput = false;

	constructor(options: {
		gpuDevice: GPUDevice;
		gpuContext: GPUCanvasContext;
		histogramGpuContext?: GPUCanvasContext;
		waveformHorizontalGpuContext?: GPUCanvasContext;
		waveformVerticalGpuContext?: GPUCanvasContext;
	}) {
		this.gpuDevice = options.gpuDevice;
		this.gpuContext = options.gpuContext;

		if (options.histogramGpuContext) this.gpuHistogram = new GpuHistogram(
			this.gpuDevice,
			options.histogramGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);
		if (options.waveformHorizontalGpuContext) this.gpuWaveformHorizontal = new GpuWaveform(
			this.gpuDevice,
			options.waveformHorizontalGpuContext,
			navigator.gpu.getPreferredCanvasFormat(),
		);

		if (options.waveformVerticalGpuContext) this.gpuWaveformVertical = new GpuWaveform(
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
				clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
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
		this.finalRenderBindGroup = null;
		this.latestRenderedToCanasTexture = null;
	}

	public destroy() {
		this.gpuHistogram?.dispose();
		this.gpuWaveformHorizontal?.dispose();
		this.gpuWaveformVertical?.dispose();
	}
}
