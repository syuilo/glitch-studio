import computeShaderCode from './histogram-compute.wgsl?raw';
import renderShaderCode from './histogram-render.wgsl?raw';

const BIN_COUNT = 256;
const CHANNEL_COUNT = 3;
const HISTOGRAM_VALUE_COUNT = (BIN_COUNT * CHANNEL_COUNT) + 1;

export class GpuHistogram {
	private readonly context: GPUCanvasContext;
	private readonly histogramBuffer: GPUBuffer;
	private readonly accumulatePipeline: GPUComputePipeline;
	private readonly maxPipeline: GPUComputePipeline;
	private readonly gridPipeline: GPURenderPipeline;
	private readonly barsPipeline: GPURenderPipeline;
	private readonly accumulateBindGroupLayout: GPUBindGroupLayout;
	private readonly maxBindGroup: GPUBindGroup;
	private readonly renderBindGroup: GPUBindGroup;
	private sourceTexture: GPUTexture | null = null;
	private accumulateBindGroup: GPUBindGroup | null = null;

	constructor(
		private readonly device: GPUDevice,
		context: GPUCanvasContext,
		format: GPUTextureFormat,
	) {
		this.context = context;
		this.context.configure({
			device,
			format,
			alphaMode: 'premultiplied',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.histogramBuffer = device.createBuffer({
			label: 'histogram values',
			size: HISTOGRAM_VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});

		const computeModule = device.createShaderModule({
			label: 'histogram compute shader',
			code: computeShaderCode,
		});
		this.accumulateBindGroupLayout = device.createBindGroupLayout({
			label: 'histogram accumulation bind group layout',
			entries: [
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
		this.gridPipeline = device.createRenderPipeline({
			label: 'histogram grid pipeline',
			layout: 'auto',
			vertex: { module: renderModule, entryPoint: 'gridVs' },
			fragment: {
				module: renderModule,
				entryPoint: 'fs',
				targets: [{ format }],
			},
			primitive: { topology: 'triangle-list' },
		});

		const renderBindGroupLayout = device.createBindGroupLayout({
			label: 'histogram render bind group layout',
			entries: [{
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
			entries: [{ binding: 0, resource: { buffer: this.histogramBuffer } }],
		});
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture) {
		if (this.sourceTexture !== sourceTexture) {
			this.sourceTexture = sourceTexture;
			this.accumulateBindGroup = this.device.createBindGroup({
				label: 'histogram accumulation bind group',
				layout: this.accumulateBindGroupLayout,
				entries: [
					{ binding: 0, resource: sourceTexture.createView() },
					{ binding: 1, resource: { buffer: this.histogramBuffer } },
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
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		renderPass.setPipeline(this.gridPipeline);
		renderPass.draw(6, 14);
		renderPass.setPipeline(this.barsPipeline);
		renderPass.setBindGroup(0, this.renderBindGroup);
		renderPass.draw(6, BIN_COUNT * CHANNEL_COUNT);
		renderPass.end();
	}

	public dispose() {
		this.histogramBuffer.destroy();
		this.context.unconfigure();
	}
}
