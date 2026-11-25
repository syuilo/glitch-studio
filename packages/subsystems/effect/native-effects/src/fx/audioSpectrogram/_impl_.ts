import { INTERMEDIATE_TEXTURE_FORMAT } from '@gs/shared/types.ts';
import { AudioInputSpectrogram } from '@gs/subsystems_audio_renderer/audio-input-spectrogram.ts';
import { createSpectrogramRenderer, getSpectrogramHistoryKey, resolveSpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import { createAudioWindowReader } from '../../audio-window.ts';
import type { EffectFrameContext, NativeEffectImplementation } from '@gs/subsystems_effect_renderer/effect-instance.ts';
import { bindParameterValues, beginOutputPass } from '../../multipass.ts';
import type { SpectrogramAnalysisRequest } from '@gs/subsystems_audio_renderer/audio-input-spectrogram.ts';
import type definition from './_def_.ts';

// enumは文字列で保存し、共通の音声解析処理には数値のFFTサイズを渡す。
const fftSizes = {
	'256': 256,
	'512': 512,
	'1024': 1024,
	'2048': 2048,
	'4096': 4096,
	'8192': 8192,
	'16384': 16384,
	'32768': 32768,
} as const;

const implementation: NativeEffectImplementation<typeof definition.paramDefs> = {
	init(placement) {
		const { device, defaultVertexShaderModule, enable32bitDataTextures, inputs, outputTextures } = placement;
		const params = bindParameterValues(inputs);
		const outputTexture = outputTextures.get('output')!;
		const outputView = outputTexture.createView();
		const loader = createAudioWindowReader();
		const analysis = new AudioInputSpectrogram();
		const spectrogram = createSpectrogramRenderer({
			device,
			vertexShaderModule: defaultVertexShaderModule,
			format: INTERMEDIATE_TEXTURE_FORMAT,
			enable32bitDataTextures,
		});
		let request: SpectrogramAnalysisRequest | null = null;
		let requestKey: string | null = null;
		let renderedHistoryKey: string | null = null;
		let settings: ReturnType<typeof resolveSpectrogramSettings>;
		let historyKey: string;
		const prepare = (_frame: EffectFrameContext, signal: AbortSignal) => {
			// 解析とGPUへの転送に同じ設定を使い、音声窓を設定の中に保持しない。
			const { audio, fftSize, ...display } = params;
			const sampleRate = audio?.sampleRate ?? 48000;
			settings = resolveSpectrogramSettings({ ...display, fftSize: fftSizes[fftSize] }, sampleRate);
			historyKey = getSpectrogramHistoryKey(settings, sampleRate);
			const key = JSON.stringify([params.audio?.cacheKey ?? null, historyKey]);
			if (key !== requestKey) {
				request = params.audio == null ? null : analysis.plan(params.audio, {
					fftSize: settings.fftSize,
					windowName: settings.window,
					channel: settings.channel,
					smoothing: settings.smoothing,
				}, historyKey !== renderedHistoryKey);
				requestKey = key;
			}
			return loader.prepare(request?.durationSeconds == null ? null : params.audio, request?.durationSeconds ?? 1, signal);
		};
		return {
			prepare,
			resetRenderHistory() {
				requestKey = null;
				analysis.reset();
				spectrogram.reset();
				renderedHistoryKey = null;
			},
			render(ctx) {
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
					renderedHistoryKey = historyKey;
				}
				const pass = beginOutputPass(ctx.commandEncoder, outputView);
				const visible = params.audio != null && request != null && (request.durationSeconds == null || loader.window != null);
				spectrogram.render(params.audio?.endFrame ?? 0, pass, visible);
				pass.end();
			},
			dispose() {
				spectrogram.dispose();
			},
		};
	},
};

export default implementation;
