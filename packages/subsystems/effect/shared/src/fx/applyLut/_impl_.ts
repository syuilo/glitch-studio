import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createLutLoader } from './lut-loader.ts';
import { createLutLayout, createLutResources } from './lut-resources.ts';
import code from './shader.wgsl?raw';
import colorSpaceShaderCode from '@gs/shared/gpu/color-space.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	init: ({ wgpu, reportStatus, resources }) => {
		const layout = createLutLayout(wgpu.device);
		const bypass = createLutResources(wgpu.device, layout, wgpu.enable32bitDataTextures, null);
		const pipelines = createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code: colorSpaceShaderCode + '\n' + code,
			schema: { input: 'color' },
			targets: [{ format: INTERMEDIATE_TEXTURE_FORMAT }],
			internalLayouts: [layout],
		});
		const loader = createLutLoader(resources.lut ?? null, lut => createLutResources(wgpu.device, layout, wgpu.enable32bitDataTextures, lut), reportStatus);
		return {
			get cacheVersion() { return loader.cacheVersion; },
			render: ctx => {
				const output = ctx.outputDataMap.output;
				// Visual Module Live Previewは非同期準備を待たずに描画する。読み込み中は透明にし、
				// 完了時のcacheVersion更新で再描画する。例外を投げるとVisual Module Live Previewの描画が停止する。
				// 書き出し側はwaitUntilReadyで待機し、読み込み失敗も状態通知から受け取る。
				if (!loader.ready) {
					const pass = ctx.createPassEncoder(ctx.commandEncoder, {
						colorAttachments: [{
							view: output.textureView,
							clearValue: [0, 0, 0, 0],
							loadOp: 'clear',
							storeOp: 'store',
						}],
					});
					pass.end();
					return;
				}
				const variant = pipelines.update({ input: ctx.params.input }, output.texture);
				const resource = loader.resource ?? bypass;
				resource.setColorSpaces(ctx.params.inputColorSpace, ctx.params.outputColorSpace);
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, resource.bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(3);
				pass.end();
			},
			dispose: () => {
				loader.dispose();
				bypass.dispose();
				pipelines.dispose();
			},
		};
	},
});
