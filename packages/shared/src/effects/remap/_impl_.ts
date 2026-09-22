import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '../../shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition, 'shaderInput'>({
	inputMode: 'shaderInput',
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const pipelines = createShaderInputPipeline({
			device, vertex: wgpu.defaultVertexShaderModule, code,
			schema: { input: 'scalar', inMin: 'scalar', inMax: 'scalar', outMin: 'scalar', outMax: 'scalar' },
			targets: [{ format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float' }],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const variant = pipelines.update({ input: ctx.params.input, inMin: ctx.params.inMin, inMax: ctx.params.inMax, outMin: ctx.params.outMin, outMax: ctx.params.outMax }, ctx.outputDataMap.output.texture);
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
