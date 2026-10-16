import type definition from './_def_.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const pipelines = createShaderInputPipeline({
			device: wgpu.device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'color', rMax: 'scalar', rMin: 'scalar', gMax: 'scalar', gMin: 'scalar', bMax: 'scalar', bMin: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
		});
		return {
			render: ctx => {
				const variant = pipelines.update(ctx.params, ctx.outputDataMap.output.texture);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
				pass.end();
			},
			dispose: () => {
				pipelines.dispose();
			},
		};
	},
});
