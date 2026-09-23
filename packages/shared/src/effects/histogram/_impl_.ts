import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputBindings, generateShaderInputs } from '../../shader-input.ts';
import type { ShaderInput } from '../../shader-input.ts';
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
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat }, resolution, params }) => {
		const accumulateLayout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
			{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
		] });
		const createVariant = (input: ShaderInput) => {
			const generated = generateShaderInputs({ input: 'color' }, { input }, 1, 'level0');
			const bindings = createShaderInputBindings(device, generated);
			try {
				const module = device.createShaderModule({ code: generated.code + '\n' + code });
				const pipeline = device.createComputePipeline({
					layout: device.createPipelineLayout({ bindGroupLayouts: [accumulateLayout, bindings.layout] }),
					compute: { module, entryPoint: 'accumulate' },
				});
				return { module, pipeline, bindings };
			} catch (error) {
				bindings.dispose();
				throw error;
			}
		};
		const variants = new Map<ShaderInput['kind'], ReturnType<typeof createVariant>>();
		const getVariant = (input: ShaderInput) => {
			let variant = variants.get(input.kind);
			if (variant == null) {
				variant = createVariant(input);
				variants.set(input.kind, variant);
			}
			return variant;
		};
		// 集計後の処理は入力を読まないため、入力種別によらずpipelineを共有する。
		const module = getVariant(params.input).module;
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
		const accumulateGroup = device.createBindGroup({ layout: accumulateLayout, entries: [uniformEntry, histogramEntry] });
		return {
			render: ctx => {
				const divisor = ctx.params.resolution ?? 1;
				const width = Math.max(1, Math.ceil(resolution.width / divisor));
				const height = Math.max(1, Math.ceil(resolution.height / divisor));
				const sampleCount = width * height;
				// Each sample contributes at most 255; prevent u32 overflow even for a solid image.
				if ((ctx.params.input.kind === 'uniform' && ctx.params.input.value.every(value => value === 0))
					|| !Number.isSafeInteger(sampleCount)
					|| sampleCount > Math.floor(0xffffffff / 255)
					|| Math.ceil(width / 16) > device.limits.maxComputeWorkgroupsPerDimension
					|| Math.ceil(height / 16) > device.limits.maxComputeWorkgroupsPerDimension) {
					ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView).end();
					return;
				}
				const variant = getVariant(ctx.params.input);
				// 集計用の間引き解像度によってfitが変わらないよう最終出力を基準にする。
				const inputGroup = variant.bindings.update({ input: ctx.params.input }, ctx.outputDataMap.output.texture);
				integers.set([width, height, ctx.params.mode === 'luminance' ? 1 : 0]);
				floats[3] = Math.max(0, ctx.params.height);
				device.queue.writeBuffer(uniforms, 0, values);
				ctx.commandEncoder.clearBuffer(histogram);
				const compute = ctx.createComputePassEncoder(ctx.commandEncoder);
				compute.setPipeline(variant.pipeline);
				compute.setBindGroup(0, accumulateGroup);
				compute.setBindGroup(1, inputGroup);
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
				for (const variant of variants.values()) variant.bindings.dispose();
				variants.clear();
				uniforms.destroy();
				histogram.destroy();
			},
		};
	},
});
