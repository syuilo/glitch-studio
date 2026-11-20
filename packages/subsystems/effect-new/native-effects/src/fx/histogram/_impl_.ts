import { createNativeEffectInputBindings } from '../../shader-input.ts';
import type { NativeEffectImplementation } from '@gs/subsystems_effect-new_renderer/effect-instance.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	async init({ device, defaultVertexShaderModule, resolution, inputs, outputTextures }) {
		const texture = outputTextures.get('output')!;
		const descriptor: GPURenderPassDescriptor = { colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store' }] };
		const accumulateLayout = device.createBindGroupLayout({
			entries: [
				{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
				{ binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
			],
		});
		const bindings = createNativeEffectInputBindings({ device, resolution, schema: { input: 'color' }, inputs, group: 1, sampling: 'level0' });
		const module = device.createShaderModule({ code: bindings.code + '\n' + code });
		let pipelines;
		try {
			pipelines = await Promise.all([
				device.createComputePipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [accumulateLayout, bindings.layout] }),
					compute: { module, entryPoint: 'accumulate' } }),
				device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'findMax' } }),
				device.createRenderPipelineAsync({ layout: 'auto', vertex: { module: defaultVertexShaderModule },
					fragment: { module, entryPoint: 'fs', targets: [{ format: texture.format }] } }),
			]);
		} catch (error) {
			bindings.dispose();
			throw error;
		}
		const [accumulate, findMax, output] = pipelines;
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
			cacheKey: 0,
			render({ commandEncoder }) {
				const divisor = Number(inputs.resolution.value);
				const width = Math.max(1, Math.ceil(resolution.width / divisor));
				const height = Math.max(1, Math.ceil(resolution.height / divisor));
				const sampleCount = width * height;
				// Each sample contributes at most 255; prevent u32 overflow even for a solid image.
				if ((inputs.input.kind === 'uniform' && inputs.input.value.every(value => value === 0))
					|| !Number.isSafeInteger(sampleCount)
					|| sampleCount > Math.floor(0xffffffff / 255)
					|| Math.ceil(width / 16) > device.limits.maxComputeWorkgroupsPerDimension
					|| Math.ceil(height / 16) > device.limits.maxComputeWorkgroupsPerDimension) {
					commandEncoder.beginRenderPass(descriptor).end();
					return;
				}

				// 集計用の間引き解像度によってfitが変わらないよう最終出力を基準にする。
				const inputGroup = bindings.getBindGroup();
				integers.set([width, height, inputs.mode.value === 'luminance' ? 1 : 0]);
				floats[3] = Math.max(0, inputs.height.value);
				device.queue.writeBuffer(uniforms, 0, values);
				commandEncoder.clearBuffer(histogram);
				const compute = commandEncoder.beginComputePass();
				compute.setPipeline(accumulate);
				compute.setBindGroup(0, accumulateGroup);
				compute.setBindGroup(1, inputGroup);
				compute.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
				compute.setPipeline(findMax);
				compute.setBindGroup(0, maxGroup);
				compute.dispatchWorkgroups(1);
				compute.end();
				const render = commandEncoder.beginRenderPass(descriptor);
				render.setPipeline(output);
				render.setBindGroup(0, outputGroup);
				render.draw(3);
				render.end();
			},
			dispose: () => {
				bindings.dispose();
				uniforms.destroy();
				histogram.destroy();
			},
		};
	},
};

export default implementation;
