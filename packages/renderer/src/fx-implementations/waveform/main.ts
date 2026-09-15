import type definition from '@glitch/shared/fx-definitions/waveform.ts';
import { implementEffect } from '../../fx-implementation.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution, params, fallbackTexture }) => {
		const getSize = (divisor: number) => ({
			width: Math.max(1, Math.ceil(resolution.width / divisor)),
			height: Math.max(1, Math.ceil(resolution.height / divisor)),
		});
		let size = getSize(params.resolution ?? 1);
		const createWaveform = (dimensions: typeof size) => {
			const byteLength = dimensions.width * dimensions.height * 3 * Uint32Array.BYTES_PER_ELEMENT;
			if (!Number.isSafeInteger(byteLength)
				|| byteLength > Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize)
				|| Math.ceil(dimensions.width / 16) > device.limits.maxComputeWorkgroupsPerDimension
				|| Math.ceil(dimensions.height / 16) > device.limits.maxComputeWorkgroupsPerDimension) {
				return null;
			}
			return device.createBuffer({
				size: byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});
		};
		const module = device.createShaderModule({ code });
		const sampler = device.createSampler({
			minFilter: 'linear',
			magFilter: 'linear',
			addressModeU: 'clamp-to-edge',
			addressModeV: 'clamp-to-edge',
		});
		const computeLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 1, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
				{ binding: 4, visibility: GPUShaderStage.COMPUTE, sampler: { type: 'filtering' } },
			],
		});
		const accumulate = device.createComputePipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [computeLayout] }),
			compute: { module, entryPoint: 'accumulate' },
		});
		const output = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		let waveform = createWaveform(size);
		const values = new ArrayBuffer(24);
		const integers = new Uint32Array(values);
		const floats = new Float32Array(values);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
		const createOutputGroup = () => waveform == null ? null : device.createBindGroup({
			layout: output.getBindGroupLayout(0),
			entries: [uniformEntry, { binding: 3, resource: { buffer: waveform } }],
		});
		let outputGroup = createOutputGroup();
		let input = params.input;
		const createInputGroup = () => waveform == null ? null : device.createBindGroup({
			layout: computeLayout,
			entries: [
				uniformEntry,
				{ binding: 1, resource: (input ?? fallbackTexture).createView() },
				{ binding: 2, resource: { buffer: waveform } },
				{ binding: 4, resource: sampler },
			],
		});
		let inputGroup = createInputGroup();
		return {
			render: ctx => {
				const nextSize = getSize(ctx.params.resolution ?? 1);
				const resized = size.width !== nextSize.width || size.height !== nextSize.height;
				if (resized) {
					waveform?.destroy();
					waveform = createWaveform(nextSize);
					size = nextSize;
					outputGroup = createOutputGroup();
				}
				if (input !== ctx.params.input || resized) {
					input = ctx.params.input;
					inputGroup = createInputGroup();
				}
				if (waveform == null || inputGroup == null || outputGroup == null) {
					// Clear stale output while unsupported, and retry when the internal size changes.
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				integers[0] = ctx.params.mode === 'luminance' ? 1 : 0;
				floats[1] = Math.max(0, ctx.params.intensity);
				integers.set([size.width, size.height], 2);
				integers[4] = ctx.params.direction === 'vertical' ? 1 : 0;
				device.queue.writeBuffer(uniforms, 0, values);
				ctx.commandEncoder.clearBuffer(waveform);
				if (input != null) {
					const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
					compute.setPipeline(accumulate);
					compute.setBindGroup(0, inputGroup);
					compute.dispatchWorkgroups(Math.ceil(size.width / 16), Math.ceil(size.height / 16));
					compute.end();
				}
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(output);
				render.setBindGroup(0, outputGroup);
				render.draw(6);
				render.end();
			},
			dispose: () => {
				uniforms.destroy();
				waveform?.destroy();
			},
		};
	},
});
