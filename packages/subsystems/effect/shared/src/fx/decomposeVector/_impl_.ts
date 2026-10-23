import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		x: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		y: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const format = wgpu.enable32bitDataTextures ? 'r32float' : 'r16float';
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'vector' },
			targets: [{ format }, { format }],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const variant = pipelines.update(ctx.params, ctx.outputDataMap.x.texture);
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: [ctx.outputDataMap.x, ctx.outputDataMap.y].map(output => ({
						view: output.textureView,
						clearValue: [0, 0, 0, 0],
						loadOp: 'clear' as const,
						storeOp: 'store' as const,
					})),
				});
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => pipelines.dispose(),
		};
	},
});
