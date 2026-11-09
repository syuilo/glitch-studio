import computeShaderCode from './histogram-compute.wgsl?raw';
import renderShaderCode from './histogram-render.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import imageValueScaleShaderCode from '@gs/shared/gpu/image-value-scale.wgsl?raw';
import imageAnalysisShaderCode from '@gs/shared/gpu/image-analysis.wgsl?raw';
import { IMAGE_ANALYSIS_MODES, resolveImageAnalysisValueScale } from '@gs/shared/utility/image-analysis.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';
import { IMAGE_VALUE_SCALES } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { PreviewCanvasContext } from '../../preview-canvas-context.ts';

const BIN_COUNT = 256;
const CHANNEL_COUNT = 3;
const HISTOGRAM_VALUE_COUNT = (BIN_COUNT * CHANNEL_COUNT) + 1;

export class GpuHistogram {
	public valueScale: ImageValueScale = 'srgb';
	public target: ImageAnalysisTarget = 'rgb';
	private readonly valueScaleBuffer: GPUBuffer;
	private readonly context: PreviewCanvasContext;
	private readonly histogramBuffer: GPUBuffer;
	private readonly accumulatePipeline: GPUComputePipeline;
	private readonly maxPipeline: GPUComputePipeline;
	private readonly barsPipeline: GPURenderPipeline;
	private readonly accumulateBindGroupLayout: GPUBindGroupLayout;
	private readonly maxBindGroup: GPUBindGroup;
	private readonly renderBindGroup: GPUBindGroup;
	private sourceTexture: GPUTexture | null = null;
	private accumulateBindGroup: GPUBindGroup | null = null;

	constructor(
		private readonly device: GPUDevice,
		context: PreviewCanvasContext,
		format: GPUTextureFormat,
	) {
		this.context = context;
		this.valueScaleBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		this.context.configure({
			device,
			format,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.histogramBuffer = device.createBuffer({
			label: 'histogram values',
			size: HISTOGRAM_VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});

		const computeModule = device.createShaderModule({
			label: 'histogram compute shader',
			code: colorSpaceShaderCode + '\n' + imageValueScaleShaderCode + '\n' + imageAnalysisShaderCode + '\n' + computeShaderCode,
		});
		this.accumulateBindGroupLayout = device.createBindGroupLayout({
			label: 'histogram accumulation bind group layout',
			entries: [
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: 'unfilterable-float' },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'storage' },
				},
			],
		});
		this.accumulatePipeline = device.createComputePipeline({
			label: 'histogram accumulation pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.accumulateBindGroupLayout],
			}),
			compute: {
				module: computeModule,
				entryPoint: 'accumulate',
			},
		});

		const maxBindGroupLayout = device.createBindGroupLayout({
			label: 'histogram maximum bind group layout',
			entries: [{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: 'storage' },
			}],
		});
		this.maxPipeline = device.createComputePipeline({
			label: 'histogram maximum pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [maxBindGroupLayout],
			}),
			compute: {
				module: computeModule,
				entryPoint: 'findMax',
			},
		});
		this.maxBindGroup = device.createBindGroup({
			label: 'histogram maximum bind group',
			layout: maxBindGroupLayout,
			entries: [{ binding: 1, resource: { buffer: this.histogramBuffer } }],
		});

		const renderModule = device.createShaderModule({
			label: 'histogram render shader',
			code: renderShaderCode,
		});
		const renderBindGroupLayout = device.createBindGroupLayout({
			label: 'histogram render bind group layout',
			entries: [{ binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }, {
				binding: 0,
				visibility: GPUShaderStage.VERTEX,
				buffer: { type: 'read-only-storage' },
			}],
		});
		this.barsPipeline = device.createRenderPipeline({
			label: 'histogram bars pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [renderBindGroupLayout],
			}),
			vertex: { module: renderModule, entryPoint: 'barsVs' },
			fragment: {
				module: renderModule,
				entryPoint: 'fs',
				targets: [{
					format,
					blend: {
						color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
						alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
					},
				}],
			},
			primitive: { topology: 'triangle-list' },
		});
		this.renderBindGroup = device.createBindGroup({
			label: 'histogram render bind group',
			layout: renderBindGroupLayout,
			entries: [{ binding: 0, resource: { buffer: this.histogramBuffer } }, { binding: 1, resource: { buffer: this.valueScaleBuffer } }],
		});
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture) {
		this.device.queue.writeBuffer(this.valueScaleBuffer, 0, new Uint32Array([
			IMAGE_VALUE_SCALES.indexOf(resolveImageAnalysisValueScale(this.target, this.valueScale)), IMAGE_ANALYSIS_MODES.indexOf(this.target), 0, 0,
		]));
		if (this.sourceTexture !== sourceTexture) {
			this.sourceTexture = sourceTexture;
			this.accumulateBindGroup = this.device.createBindGroup({
				label: 'histogram accumulation bind group',
				layout: this.accumulateBindGroupLayout,
				entries: [
					{ binding: 0, resource: sourceTexture.createView() },
					{ binding: 1, resource: { buffer: this.histogramBuffer } },
					{ binding: 2, resource: { buffer: this.valueScaleBuffer } },
				],
			});
		}

		commandEncoder.clearBuffer(this.histogramBuffer);

		const accumulatePass = commandEncoder.beginComputePass({
			label: 'accumulate histogram',
		});
		accumulatePass.setPipeline(this.accumulatePipeline);
		accumulatePass.setBindGroup(0, this.accumulateBindGroup!);
		accumulatePass.dispatchWorkgroups(10, 10);
		accumulatePass.end();

		const maxPass = commandEncoder.beginComputePass({
			label: 'find histogram maximum',
		});
		maxPass.setPipeline(this.maxPipeline);
		maxPass.setBindGroup(0, this.maxBindGroup);
		maxPass.dispatchWorkgroups(1);
		maxPass.end();

		const renderPass = commandEncoder.beginRenderPass({
			label: 'render histogram',
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: {
					r: 0,
					g: 0,
					b: 0,
					a: 1,
				},
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		renderPass.setPipeline(this.barsPipeline);
		renderPass.setBindGroup(0, this.renderBindGroup);
		renderPass.draw(6, BIN_COUNT * (this.target === 'rgb' ? CHANNEL_COUNT : 1));
		renderPass.end();
	}

	public dispose() {
		this.valueScaleBuffer.destroy();
		this.histogramBuffer.destroy();
		this.context.unconfigure();
	}
}
