import { createAudioSpectrogram } from '@glitch/shared/utility/audio-spectrogram/audio-spectrogram.js';
import { implementEffect } from '../../fx-implementation.ts';
import type definition from '@glitch/shared/fx-definitions/audioSpectrogram.ts';

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
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enableFloat32Filtering } }) => {
		const spectrogram = createAudioSpectrogram(device, defaultVertexShaderModule, intermediateTextureFormat, enableFloat32Filtering);
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
