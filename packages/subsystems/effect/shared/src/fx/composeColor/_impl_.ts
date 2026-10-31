import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	// 各成分を対等に扱い、Alphaだけがスカラー場の場合も入力の解像度を引き継ぐ。
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu }) => {
		const device = wgpu.device;
		const pipelines = createShaderInputPipeline({
			device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { red: 'scalar', green: 'scalar', blue: 'scalar', alpha: 'scalar' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
			sampling: 'level0',
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
