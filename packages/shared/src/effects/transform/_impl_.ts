import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	getOut: ({ wgpu, resolution }) => ({
		output: wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	}),
	init: ({ wgpu, resolution, fallbackTexture }) => {
		const device = wgpu.device;
		const layout = device.createBindGroupLayout({ entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			...[2, 3, 4].map(binding => ({
				binding, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' as const },
			})),
			{ binding: 6, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
			{ binding: 5, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		] });
		const pipeline = device.createRenderPipeline({
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module: wgpu.defaultVertexShaderModule },
			fragment: { module: device.createShaderModule({ code }), targets: [{ format: wgpu.intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniformBuffer = device.createBuffer({ size: 8, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const uniformData = new ArrayBuffer(8);
		new Float32Array(uniformData)[0] = resolution.width / resolution.height;
		const createSampler = (addressMode: GPUAddressMode) => device.createSampler({
			minFilter: 'linear', magFilter: 'linear', addressModeU: addressMode, addressModeV: addressMode,
		});
		const clampSampler = createSampler('clamp-to-edge');
		const samplers = {
			transparent: clampSampler,
			clampToEdge: clampSampler,
			repeat: createSampler('repeat'),
			repeatMirrored: createSampler('mirror-repeat'),
		};
		let textures: GPUTexture[] = [];
		let sampler: GPUSampler;
		let bindGroup: GPUBindGroup;
		return {
			render: ctx => {
				const p = ctx.params;
				new Uint32Array(uniformData)[1] = p.wrap === 'transparent' ? 1 : 0;
				device.queue.writeBuffer(uniformBuffer, 0, uniformData);
				const inputs = [p.input ?? fallbackTexture, p.translation, p.scale, p.rotation];
				if (inputs.some((texture, i) => texture !== textures[i]) || sampler !== samplers[p.wrap]) {
					textures = inputs;
					sampler = samplers[p.wrap];
					bindGroup = device.createBindGroup({ layout, entries: [
						{ binding: 0, resource: { buffer: uniformBuffer } },
						...textures.map((texture, i) => ({ binding: i + 1, resource: texture.createView() })),
						{ binding: 5, resource: sampler },
						{ binding: 6, resource: clampSampler },
					] });
				}
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(pipeline);
				pass.setBindGroup(0, bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => uniformBuffer.destroy(),
		};
	},
});
