import { implementEffect } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		output2: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'r32float' : 'r16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
		output3: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.enable32bitDataTextures ? 'rg32float' : 'rg16float',
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
	},
	// パラメータ受け渡しを確認する診断用エフェクト。描画しないためGPUリソースは作らない。
	init: () => ({
		render: (ctx) => {
			console.log(ctx.params);
		},
		dispose: () => {},
	}),
});
