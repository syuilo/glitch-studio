import { createAudioSpectrogram } from '@glitch/shared/utility/audio-spectrogram/audio-spectrogram.js';
import { implementEffect } from '../../effect-implementation.ts';
import type definition from './_def_.ts';

// enumは文字列で保存し、共通の音声解析処理には数値のFFTサイズを渡す。
const fftSizes = { '256': 256, '512': 512, '1024': 1024, '2048': 2048, '4096': 4096, '8192': 8192, '16384': 16384, '32768': 32768 } as const;

export default implementEffect<typeof definition>({
	disableCache: true,
	outputTextureFactories: {
		output: ({ wgpu, resolution }) => wgpu.device.createTexture({
			size: resolution,
			format: wgpu.intermediateTextureFormat,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		}),
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
				spectrogram.render(ctx.params.player?.audio ?? null, { ...ctx.params, fftSize: fftSizes[ctx.params.fftSize] }, pass);
				pass.end();
			},
			dispose: () => spectrogram.dispose(),
		};
	},
});
