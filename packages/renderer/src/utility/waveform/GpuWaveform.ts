import computeShaderCode from './waveform-compute.wgsl?raw';
import renderShaderCode from './waveform-render.wgsl?raw';

const MAX_SAMPLE_EDGE = 1024;
const WORKGROUP_SIZE = 16;
const POSITION_COUNT = 512;
const LEVEL_COUNT = 256;
const CHANNEL_COUNT = 3;
const WAVEFORM_VALUE_COUNT = POSITION_COUNT * LEVEL_COUNT * CHANNEL_COUNT;

export function fitWaveformSampleSize(width: number, height: number) {
	const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(width, height));
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	};
}

export class GpuWaveform {
	private readonly context: GPUCanvasContext;
	private readonly waveformBuffer: GPUBuffer;
	private readonly paramsBuffer: GPUBuffer;
	private readonly accumulatePipeline: GPUComputePipeline;
	private readonly renderPipeline: GPURenderPipeline;
	private readonly accumulateBindGroupLayout: GPUBindGroupLayout;
	private readonly renderBindGroup: GPUBindGroup;
	private sourceTexture: GPUTexture | null = null;
	private accumulateBindGroup: GPUBindGroup | null = null;

	constructor(
		private readonly device: GPUDevice,
		context: GPUCanvasContext,
		format: GPUTextureFormat,
		positionAxis: 'x' | 'y' = 'x',
	) {
		this.context = context;
		this.context.configure({
			device,
			format,
			alphaMode: 'opaque',
			usage: GPUTextureUsage.RENDER_ATTACHMENT,
		});

		this.waveformBuffer = device.createBuffer({
			label: 'waveform values',
			size: WAVEFORM_VALUE_COUNT * Uint32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		this.paramsBuffer = device.createBuffer({
			label: 'waveform params',
			size: 2 * Uint32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});

		const computeModule = device.createShaderModule({
			label: 'waveform compute shader',
			code: computeShaderCode,
		});
		this.accumulateBindGroupLayout = device.createBindGroupLayout({
			label: 'waveform accumulation bind group layout',
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
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: 'uniform' },
				},
			],
		});
		this.accumulatePipeline = device.createComputePipeline({
			label: 'waveform accumulation pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.accumulateBindGroupLayout],
			}),
			compute: {
				module: computeModule,
				entryPoint: 'accumulate',
				constants: { VERTICAL_POSITION: positionAxis === 'y' ? 1 : 0 },
			},
		});

		const renderModule = device.createShaderModule({
			label: 'waveform render shader',
			code: renderShaderCode,
		});
		const renderBindGroupLayout = device.createBindGroupLayout({
			label: 'waveform render bind group layout',
			entries: [{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: 'read-only-storage' },
			}],
		});
		this.renderPipeline = device.createRenderPipeline({
			label: 'waveform render pipeline',
			layout: device.createPipelineLayout({
				bindGroupLayouts: [renderBindGroupLayout],
			}),
			vertex: { module: renderModule, entryPoint: 'vs' },
			fragment: {
				module: renderModule,
				entryPoint: 'fs',
				constants: { VERTICAL_POSITION: positionAxis === 'y' ? 1 : 0 },
				targets: [{ format }],
			},
			primitive: { topology: 'triangle-list' },
		});
		this.renderBindGroup = device.createBindGroup({
			label: 'waveform render bind group',
			layout: renderBindGroupLayout,
			entries: [{ binding: 0, resource: { buffer: this.waveformBuffer } }],
		});
	}

	public render(commandEncoder: GPUCommandEncoder, sourceTexture: GPUTexture) {
		if (this.sourceTexture !== sourceTexture) {
			this.sourceTexture = sourceTexture;
			this.accumulateBindGroup = this.device.createBindGroup({
				label: 'waveform accumulation bind group',
				layout: this.accumulateBindGroupLayout,
				entries: [
					{ binding: 0, resource: sourceTexture.createView() },
					{ binding: 1, resource: { buffer: this.waveformBuffer } },
					{ binding: 2, resource: { buffer: this.paramsBuffer } },
				],
			});
		}

		const sampleSize = fitWaveformSampleSize(sourceTexture.width, sourceTexture.height);
		this.device.queue.writeBuffer(
			this.paramsBuffer,
			0,
			new Uint32Array([sampleSize.width, sampleSize.height]),
		);
		commandEncoder.clearBuffer(this.waveformBuffer);

		const computePass = commandEncoder.beginComputePass({
			label: 'accumulate waveform',
		});
		computePass.setPipeline(this.accumulatePipeline);
		computePass.setBindGroup(0, this.accumulateBindGroup!);
		computePass.dispatchWorkgroups(
			Math.ceil(sampleSize.width / WORKGROUP_SIZE),
			Math.ceil(sampleSize.height / WORKGROUP_SIZE),
		);
		computePass.end();

		const renderPass = commandEncoder.beginRenderPass({
			label: 'render waveform',
			colorAttachments: [{
				view: this.context.getCurrentTexture().createView(),
				clearValue: { r: 0, g: 0, b: 0, a: 1 },
				loadOp: 'clear',
				storeOp: 'store',
			}],
		});
		renderPass.setPipeline(this.renderPipeline);
		renderPass.setBindGroup(0, this.renderBindGroup);
		renderPass.draw(6);
		renderPass.end();
	}

	public dispose() {
		this.waveformBuffer.destroy();
		this.paramsBuffer.destroy();
		this.context.unconfigure();
	}
}
