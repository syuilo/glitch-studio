import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import imageValueScaleShaderCode from '@gs/shared/gpu/image-value-scale.wgsl?raw';
import imageAnalysisShaderCode from '@gs/shared/gpu/image-analysis.wgsl?raw';
import { IMAGE_ANALYSIS_MODES, resolveImageAnalysisValueScale } from '@gs/shared/utility/image-analysis.ts';
import { DEFAULT_IMAGE_VALUE_RANGE, IMAGE_VALUE_SCALES, isDrawableImageValueRange } from '@gs/shared/utility/image-value-scale.ts';
import { getImageAnalysisChunkCount } from '@gs/shared/utility/image-analysis-accumulation.ts';
import renderShaderCode from './histogram-render.wgsl?raw';
import computeShaderCode from './histogram-compute.wgsl?raw';
import type { PreviewCanvasContext } from '../../preview-canvas-context.ts';
import type { ImageValueRange, ImageValueScale } from '@gs/shared/utility/image-value-scale.ts';
import type { ImageAnalysisTarget } from '@gs/shared/utility/image-analysis.ts';

const BIN_COUNT = 256;
const VALUE_COUNT = BIN_COUNT * 3;

export class GpuHistogram {
	public valueScale: ImageValueScale = 'srgb';
	public target: ImageAnalysisTarget = 'rgb';
	public valueRange: ImageValueRange = { ...DEFAULT_IMAGE_VALUE_RANGE };
	private readonly settingsBuffer: GPUBuffer;
	private readonly histogramBuffer: GPUBuffer;
	private partialHistograms: GPUBuffer | null = null;
	private partialCapacity = 0;
	private readonly accumulateLayout: GPUBindGroupLayout;
	private readonly computeModule: GPUShaderModule;
	private readonly renderModule: GPUShaderModule;
	private readonly accumulatePipeline: GPUComputePipeline;
	private readonly maxPipeline: GPUComputePipeline;
	private readonly barsPipeline: GPURenderPipeline;
	private readonly maxBindGroup: GPUBindGroup;
	private readonly renderBindGroup: GPUBindGroup;
	private sourceTexture: GPUTexture | null = null;
	private accumulateBindGroup: GPUBindGroup | null = null;
	private reduceBindGroup: GPUBindGroup | null = null;
	private partialPipelines: ReturnType<GpuHistogram['createPartialPipelines']> | null = null;

	constructor(private readonly device: GPUDevice, private readonly context: PreviewCanvasContext, private readonly format: GPUTextureFormat) {
		this.settingsBuffer = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		context.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT });
		this.histogramBuffer = device.createBuffer({ label: 'histogram values', size: (VALUE_COUNT + 1) * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		this.computeModule = device.createShaderModule({ code: colorSpaceShaderCode + '\n' + imageValueScaleShaderCode + '\n' + imageAnalysisShaderCode + '\n' + computeShaderCode });
		this.accumulateLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'unfilterable-float' } },
			{ binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
		] });
		this.accumulatePipeline = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [this.accumulateLayout] }), compute: { module: this.computeModule, entryPoint: 'accumulateDirect' } });
		this.maxPipeline = device.createComputePipeline({ layout: 'auto', compute: { module: this.computeModule, entryPoint: 'findDirectMax' } });
		this.maxBindGroup = device.createBindGroup({ layout: this.maxPipeline.getBindGroupLayout(0), entries: [{ binding: 1, resource: { buffer: this.histogramBuffer } }] });
		this.renderModule = device.createShaderModule({ code: renderShaderCode });
		this.barsPipeline = this.createBarsPipeline(false);
		this.renderBindGroup = this.createRenderBindGroup(this.barsPipeline);
	}

	private createBarsPipeline(usePartialSums: boolean) {
		return this.device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: this.renderModule, entryPoint: 'barsVs', constants: { usePartialSums: Number(usePartialSums) } },
			fragment: {
				module: this.renderModule,
				entryPoint: 'fs',
				targets: [{
					format: this.format,
					blend: {
						color: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
						alpha: { operation: 'add', srcFactor: 'one', dstFactor: 'one' },
					},
				}],
			},
			primitive: { topology: 'triangle-list' },
		});
	}

	private createRenderBindGroup(pipeline: GPURenderPipeline) {
		return this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
			{ binding: 0, resource: { buffer: this.histogramBuffer } }, { binding: 1, resource: { buffer: this.settingsBuffer } },
		] });
	}

	private createPartialPipelines() {
		const device = this.device;
		const module = this.computeModule;
		const accumulate = device.createComputePipeline({ layout: device.createPipelineLayout({ bindGroupLayouts: [this.accumulateLayout] }), compute: { module, entryPoint: 'accumulate' } });
		const reduce = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'reduceCounts' } });
		const maximum = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'findMax' } });
		const bars = this.createBarsPipeline(true);
		const maximumGroup = device.createBindGroup({ layout: maximum.getBindGroupLayout(0), entries: [{ binding: 3, resource: { buffer: this.histogramBuffer } }] });
		return { accumulate, reduce, maximum, bars, maximumGroup, renderGroup: this.createRenderBindGroup(bars) };
	}

	public render(encoder: GPUCommandEncoder, source: GPUTexture, fullResolution = false) {
		const sampleWidth = fullResolution ? source.width : 100;
		const sampleHeight = fullResolution ? source.height : 100;
		const chunkCount = getImageAnalysisChunkCount(sampleWidth * sampleHeight);
		// 部分和のpipelineやバッファは必要になったときだけ生成する。
		const partial = chunkCount > 1 ? this.partialPipelines ??= this.createPartialPipelines() : null;
		const partialBytes = partial == null ? 0 : chunkCount * VALUE_COUNT * 4;
		if (partialBytes > Math.min(this.device.limits.maxStorageBufferBindingSize, this.device.limits.maxBufferSize)) throw new Error('Histogram exceeds GPU buffer limits');
		if (partialBytes !== this.partialCapacity) {
			this.partialHistograms?.destroy();
			const partialHistograms = partial == null ? null : this.device.createBuffer({ label: 'partial histograms', size: partialBytes, usage: GPUBufferUsage.STORAGE });
			this.partialHistograms = partialHistograms;
			this.partialCapacity = partialBytes;
			this.sourceTexture = null;
			this.reduceBindGroup = partial == null || partialHistograms == null ? null : this.device.createBindGroup({ layout: partial.reduce.getBindGroupLayout(0), entries: [
				{ binding: 1, resource: { buffer: partialHistograms } }, { binding: 2, resource: { buffer: this.settingsBuffer } }, { binding: 3, resource: { buffer: this.histogramBuffer } },
			] });
		}
		if (this.sourceTexture !== source) {
			this.sourceTexture = source;
			this.accumulateBindGroup = this.device.createBindGroup({ layout: this.accumulateLayout, entries: [
				{ binding: 0, resource: source.createView() }, { binding: 1, resource: { buffer: this.partialHistograms ?? this.histogramBuffer } }, { binding: 2, resource: { buffer: this.settingsBuffer } },
			] });
		}
		const settings = new ArrayBuffer(32);
		new Uint32Array(settings).set([IMAGE_VALUE_SCALES.indexOf(resolveImageAnalysisValueScale(this.target, this.valueScale)), IMAGE_ANALYSIS_MODES.indexOf(this.target)]);
		new Float32Array(settings).set([this.valueRange.minimum, this.valueRange.maximum], 2);
		new Uint32Array(settings).set([sampleWidth, sampleHeight, chunkCount], 4);
		this.device.queue.writeBuffer(this.settingsBuffer, 0, settings);
		encoder.clearBuffer(this.histogramBuffer);
		if (isDrawableImageValueRange(this.valueRange)) {
			const pass = encoder.beginComputePass({ label: 'accumulate and reduce histogram' });
			pass.setPipeline(partial?.accumulate ?? this.accumulatePipeline);
			pass.setBindGroup(0, this.accumulateBindGroup!);
			if (partial == null) {
				pass.dispatchWorkgroups(Math.ceil(sampleWidth / 10), Math.ceil(sampleHeight / 10));
			} else {
				const groupsX = Math.min(chunkCount, this.device.limits.maxComputeWorkgroupsPerDimension);
				pass.dispatchWorkgroups(groupsX, Math.ceil(chunkCount / groupsX));
				pass.setPipeline(partial.reduce);
				pass.setBindGroup(0, this.reduceBindGroup!);
				pass.dispatchWorkgroups(3);
			}
			pass.end();
			const maxPass = encoder.beginComputePass({ label: 'find histogram maximum' });
			maxPass.setPipeline(partial?.maximum ?? this.maxPipeline);
			maxPass.setBindGroup(0, partial?.maximumGroup ?? this.maxBindGroup);
			maxPass.dispatchWorkgroups(1);
			maxPass.end();
		}
		const pass = encoder.beginRenderPass({ label: 'render histogram', colorAttachments: [{ view: this.context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
		pass.setPipeline(partial?.bars ?? this.barsPipeline);
		pass.setBindGroup(0, partial?.renderGroup ?? this.renderBindGroup);
		pass.draw(6, BIN_COUNT * (this.target === 'rgb' ? 3 : 1));
		pass.end();
	}

	public dispose() {
		this.settingsBuffer.destroy();
		this.histogramBuffer.destroy();
		this.partialHistograms?.destroy();
		this.context.unconfigure();
	}
}
