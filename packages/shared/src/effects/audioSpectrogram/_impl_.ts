import { createAudioSpectrogram } from '@glitch/shared/utility/audio-spectrogram/audio-spectrogram.js';
import { implementEffect } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

export default implementEffect<typeof definition>({
	disableCache: true,
	getOut: ({ wgpu, resolution }) => {
		const out = wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return { output: out };
	},
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures } }) => {
		const spectrogram = createAudioSpectrogram({
			device,
			vertexShaderModule: defaultVertexShaderModule,
			format: intermediateTextureFormat,
			enable32bitDataTextures,
		});
		return {
			render(ctx) {
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				spectrogram.render(ctx.params.player?.audio ?? null, ctx.params, pass);
				pass.end();
			},
			dispose: () => spectrogram.dispose(),
		};
	},
});
