import { AudioSpectrum } from '@gs/subsystems_audio_renderer/audio-spectrum.ts';
import { createSpectrogramRenderer, getSpectrogramHistoryKey } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import { resolvePreviewSpectrogramSettings } from './audio-preview-spectrogram-settings.ts';
import type { AudioHistory } from '@gs/subsystems_audio_renderer/audio-history.ts';
import type { SpectrogramRendererOptions } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import type { PreviewSpectrogramOptions } from './audio-preview-types.ts';

export function createPreviewSpectrogram(options: SpectrogramRendererOptions) {
	const frequencyHistory = 'fft-bins';
	const renderer = createSpectrogramRenderer({ ...options, frequencyHistory });
	let spectrum: AudioSpectrum | null = null;
	let source: AudioHistory | null = null;
	let revision = -1;
	let historyKey: string | null = null;
	let displayedFrame: { sampleRate: number; endFrame: number } | null = null;
	let wasHeld = false;
	return {
		render(audio: AudioHistory, { settings, viewport, hold }: PreviewSpectrogramOptions, pass: GPURenderPassEncoder) {
			// HOLD中は表示済みの時刻とレートを使う。新しい入力やリセットが届いても同じ履歴を参照する。
			if (!hold || displayedFrame == null) displayedFrame = { sampleRate: audio.sampleRate, endFrame: audio.endFrame };
			const { sampleRate, endFrame } = displayedFrame;
			const resolvedSettings = resolvePreviewSpectrogramSettings(settings, sampleRate);
			renderer.configure(resolvedSettings, sampleRate);
			if (!hold) {
				const key = getSpectrogramHistoryKey(resolvedSettings, sampleRate, frequencyHistory);
				if (spectrum == null || key !== historyKey || source !== audio || revision !== audio.revision || wasHeld) {
					spectrum = new AudioSpectrum(resolvedSettings.fftSize, resolvedSettings.window);
					historyKey = key;
					source = audio;
					revision = audio.revision;
					renderer.reset();
				}
				const liveSpectrum = spectrum;
				liveSpectrum.update(audio, resolvedSettings.channel, resolvedSettings.smoothing, (fftEndFrame, reset) => {
					if (reset) renderer.reset();
					renderer.append(fftEndFrame, liveSpectrum.left, liveSpectrum.right);
				}, wasHeld);
				if (!liveSpectrum.hasData) renderer.reset();
			}
			wasHeld = hold;
			renderer.render(endFrame, pass, true, viewport);
			return sampleRate;
		},
		dispose: () => renderer.dispose(),
	};
}
