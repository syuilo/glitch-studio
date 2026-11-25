import { AudioSpectrum } from '@gs/subsystems_audio_renderer/audio-spectrum.ts';
import { createSpectrogramRenderer, getSpectrogramHistoryKey, resolveSpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import type { SpectrogramRendererOptions, SpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-renderer.ts';
import type { AudioHistory } from '@gs/subsystems_audio_renderer/audio-history.ts';

export function createPreviewSpectrogram(options: SpectrogramRendererOptions) {
	const renderer = createSpectrogramRenderer(options);
	let spectrum: AudioSpectrum | null = null;
	let source: AudioHistory | null = null;
	let revision = -1;
	let historyKey: string | null = null;
	return {
		render(audio: AudioHistory | null, settings: SpectrogramSettings, pass: GPURenderPassEncoder) {
			const sampleRate = audio?.sampleRate ?? 48000;
			const p = resolveSpectrogramSettings(settings, sampleRate);
			const key = getSpectrogramHistoryKey(p, sampleRate);
			renderer.configure(p, sampleRate);
			if (key !== historyKey || source !== audio || revision !== (audio?.revision ?? -1)) {
				spectrum = new AudioSpectrum(p.fftSize, p.window);
				historyKey = key;
				source = audio;
				revision = audio?.revision ?? -1;
				renderer.reset();
			}
			spectrum!.update(audio, p.channel, p.smoothing, (endFrame, reset) => {
				if (reset) renderer.reset();
				renderer.append(endFrame, spectrum!.left, spectrum!.right);
			});
			if (!spectrum!.hasData) renderer.reset();
			renderer.render(audio?.endFrame ?? 0, pass);
		},
		dispose: () => renderer.dispose(),
	};
}
