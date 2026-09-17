import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution, params, fallbackTexture }) => {
		const module = device.createShaderModule({ code });
		const accumulate = device.createComputePipeline({
			layout: 'auto', compute: { module, entryPoint: 'accumulate' },
		});
		const findMax = device.createComputePipeline({
			layout: 'auto', compute: { module, entryPoint: 'findMax' },
		});
		const output = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, entryPoint: 'fs', targets: [{ format: intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const histogram = device.createBuffer({
			size: (256 * 3 + 1) * Uint32Array.BYTES_PER_ELEMENT,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		const values = new ArrayBuffer(24);
		const integers = new Uint32Array(values);
		const floats = new Float32Array(values);
		integers.set([resolution.width, resolution.height], 4);
		const uniforms = device.createBuffer({
			size: values.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		const sampler = device.createSampler({
			minFilter: 'linear', magFilter: 'linear',
			addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
		});
		const uniformEntry = { binding: 0, resource: { buffer: uniforms } };
		const histogramEntry = { binding: 2, resource: { buffer: histogram } };
		const maxGroup = device.createBindGroup({
			layout: findMax.getBindGroupLayout(0),
			entries: [histogramEntry],
		});
		const outputGroup = device.createBindGroup({
			layout: output.getBindGroupLayout(0),
			entries: [uniformEntry, { binding: 3, resource: { buffer: histogram } }],
		});
		let input = params.input;
		const createInputGroup = () => device.createBindGroup({
			layout: accumulate.getBindGroupLayout(0),
			entries: [
				uniformEntry,
				{ binding: 1, resource: (input ?? fallbackTexture).createView() },
				histogramEntry,
				{ binding: 4, resource: sampler },
			],
		});
		let inputGroup = createInputGroup();
		return {
			render: ctx => {
				const divisor = ctx.params.resolution ?? 1;
				const width = Math.max(1, Math.ceil(resolution.width / divisor));
				const height = Math.max(1, Math.ceil(resolution.height / divisor));
				const sampleCount = width * height;
				// Each sample contributes at most 255; prevent u32 overflow even for a solid image.
				if (ctx.params.input == null || !Number.isSafeInteger(sampleCount)
					|| sampleCount > Math.floor(0xffffffff / 255)
					|| Math.ceil(width / 16) > device.limits.maxComputeWorkgroupsPerDimension
					|| Math.ceil(height / 16) > device.limits.maxComputeWorkgroupsPerDimension) {
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				if (input !== ctx.params.input) {
					input = ctx.params.input;
					inputGroup = createInputGroup();
				}
				integers.set([width, height, ctx.params.mode === 'luminance' ? 1 : 0]);
				floats[3] = Math.max(0, ctx.params.height);
				device.queue.writeBuffer(uniforms, 0, values);
				ctx.commandEncoder.clearBuffer(histogram);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(accumulate);
				compute.setBindGroup(0, inputGroup);
				compute.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
				compute.setPipeline(findMax);
				compute.setBindGroup(0, maxGroup);
				compute.dispatchWorkgroups(1);
				compute.end();
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				render.setPipeline(output);
				render.setBindGroup(0, outputGroup);
				render.draw(6);
				render.end();
			},
			dispose: () => {
				uniforms.destroy();
				histogram.destroy();
			},
		};
	},
});
