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
		const pipeline = device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: defaultVertexShaderModule },
			fragment: { module, targets: [{ format: intermediateTextureFormat }] },
			primitive: { topology: 'triangle-list' },
		});
		const uniforms = device.createBuffer({ size: 20, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		const values = new Float32Array(5);
		values[4] = resolution.width / resolution.height;
		const createSampler = (addressMode: GPUAddressMode) => device.createSampler({
			minFilter: 'linear', magFilter: 'linear', addressModeU: addressMode, addressModeV: addressMode,
		});
		const samplers = {
			clampToEdge: createSampler('clamp-to-edge'),
			repeat: createSampler('repeat'),
			repeatMirrored: createSampler('mirror-repeat'),
		};
		let input = params.input;
		let vector = params.vector;
		let wrap = params.wrap;
		const createGroup = () => device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniforms } },
				{ binding: 1, resource: samplers[wrap] },
				{ binding: 2, resource: (input ?? fallbackTexture).createView() },
				{ binding: 3, resource: (vector ?? fallbackTexture).createView() },
				{ binding: 4, resource: samplers.clampToEdge },
			],
		});
		let group = createGroup();
		return {
			render: ctx => {
				if (input !== ctx.params.input || vector !== ctx.params.vector || wrap !== ctx.params.wrap) {
					input = ctx.params.input;
					vector = ctx.params.vector;
					wrap = ctx.params.wrap;
					group = createGroup();
				}
				values[0] = vector == null ? 0 : ctx.params.amount;
				// ベクトルは+Yが上なので、正の値を時計回りにする。
				values[1] = -(ctx.params.rotation ?? 0) * Math.PI;
				values[2] = ctx.params.flipX ? -1 : 1;
				values[3] = ctx.params.flipY ? -1 : 1;
				device.queue.writeBuffer(uniforms, 0, values);
				const render = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				if (input != null) {
					render.setPipeline(pipeline);
					render.setBindGroup(0, group);
					render.draw(6);
				}
				render.end();
			},
			dispose: () => uniforms.destroy(),
		};
	},
});
