import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import { implementEffect } from '../../effect-implementation.ts';
import { createLutLoader } from './lut-loader.ts';
import { createLutLayout, createLutResources } from './lut-resources.ts';
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
	init: ({ wgpu, reportStatus, resources }) => {
		const layout = createLutLayout(wgpu.device);
		const bypass = createLutResources(wgpu.device, layout, wgpu.enable32bitDataTextures, null);
		const pipelines = createShaderInputPipeline({
			device: wgpu.device,
			vertex: wgpu.defaultVertexShaderModule,
			code,
			schema: { input: 'color' },
			targets: [{ format: wgpu.intermediateTextureFormat }],
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
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, output.textureView);
				pass.setPipeline(variant.pipeline);
				pass.setBindGroup(0, (loader.resource ?? bypass).bindGroup);
				pass.setBindGroup(pipelines.inputGroup, variant.bindGroup);
				pass.draw(6);
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
