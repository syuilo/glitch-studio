import { implementEffect } from '../../effect-implementation.ts';
import { createShaderInputPipeline } from '@gs/shared/gpu/shader-input-pipeline.ts';
import code from './shader.wgsl?raw';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		hue: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		saturation: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		lightness: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		alpha: ({ wgpu, resolution }) => wgpu.device.createTexture({
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
			schema: { input: 'color' },
			targets: [{ format }, { format }, { format }, { format }],
			sampling: 'level0',
		});
		return {
			render: ctx => {
				const outputs = [ctx.outputDataMap.hue, ctx.outputDataMap.saturation, ctx.outputDataMap.lightness, ctx.outputDataMap.alpha];
				const variant = pipelines.update(ctx.params, ctx.outputDataMap.hue.texture);
				// 入力を一度だけサンプリングし、HSLとAlphaを同じ画素位置から同時に出力する。
				const pass = ctx.createPassEncoder(ctx.commandEncoder, {
					colorAttachments: outputs.map(output => ({
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
			dispose: () => {
				pipelines.dispose();
			},
		};
	},
});
