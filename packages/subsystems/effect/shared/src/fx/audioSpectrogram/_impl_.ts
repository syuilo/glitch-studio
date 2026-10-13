import { AudioInputSpectrogram } from '@gs/subsystems_audio_renderer/audio-input-spectrogram.ts';
import { createSpectrogramRenderer, getSpectrogramHistoryKey, resolveSpectrogramSettings } from '../../audio-spectrogram/spectrogram-renderer.ts';
import { createAudioWindowLoader } from '../../audio-window-loader.ts';
import { implementEffect } from '../../effect-implementation.ts';
import type { SpectrogramAnalysisRequest } from '@gs/subsystems_audio_renderer/audio-input-spectrogram.ts';
import type { RuntimeEffectParameters } from '../../effect-implementation.ts';
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
	init: ({ wgpu: { device, defaultVertexShaderModule, intermediateTextureFormat, enable32bitDataTextures }, reportStatus }) => {
		const loader = createAudioWindowLoader(reportStatus);
		const analysis = new AudioInputSpectrogram();
		const spectrogram = createSpectrogramRenderer({
			device,
			vertexShaderModule: defaultVertexShaderModule,
			format: intermediateTextureFormat,
			enable32bitDataTextures,
		});
		let request: SpectrogramAnalysisRequest | null = null;
		let requestKey: string | null = null;
		let renderedHistoryKey: string | null = null;
		const settingsFor = (params: RuntimeEffectParameters<typeof definition.paramDefs>) => {
			// GPU履歴には表示設定だけを保持し、入力のスナップショットやPCMを引き留めない。
			const { audio, fftSize, ...settings } = params;
			return resolveSpectrogramSettings({ ...settings, fftSize: fftSizes[fftSize] }, audio?.sampleRate ?? 48000);
		};
		const prepare = (params: RuntimeEffectParameters<typeof definition.paramDefs>, signal?: AbortSignal) => {
			const settings = settingsFor(params);
			const historyKey = getSpectrogramHistoryKey(settings, params.audio?.sampleRate ?? 48000);
			const key = JSON.stringify([params.audio?.cacheKey ?? null, historyKey]);
			if (key !== requestKey) {
				request = params.audio == null ? null : analysis.plan(params.audio, {
					fftSize: settings.fftSize, windowName: settings.window,
					channel: settings.channel, smoothing: settings.smoothing,
				}, historyKey !== renderedHistoryKey);
				requestKey = key;
			}
			loader.prepare(request?.durationSeconds == null ? null : params.audio, request?.durationSeconds ?? 1, signal);
		};
		return {
			get cacheVersion() { return loader.revision; },
			prepare,
			render(ctx) {
				const { params } = ctx;
				// LIVEは同期取得、Timelineはprepareで待機済みの窓を採用する。
				prepare(params);
				const settings = settingsFor(params);
				const sampleRate = params.audio?.sampleRate ?? 48000;
				spectrogram.configure(settings, sampleRate);
				if (params.audio == null) {
					analysis.reset();
					spectrogram.reset();
					renderedHistoryKey = null;
				} else if (request != null && (request.durationSeconds == null || loader.window != null)) {
					analysis.update(request, loader.window, (endFrame, reset, left, right) => {
						if (reset) spectrogram.reset();
						spectrogram.append(endFrame, left, right);
					});
					renderedHistoryKey = getSpectrogramHistoryKey(settings, sampleRate);
				}
				const pass = ctx.createPassEncoderFor(ctx.commandEncoder, ctx.outputDataMap.output.textureView);
				const visible = params.audio != null && request != null && (request.durationSeconds == null || loader.window != null);
				spectrogram.render(params.audio?.endFrame ?? 0, pass, visible);
				pass.end();
			},
			dispose() {
				loader.dispose();
				spectrogram.dispose();
			},
		};
	},
});
