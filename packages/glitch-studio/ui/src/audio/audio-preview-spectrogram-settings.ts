import { resolveSpectrogramSettings } from '@gs/subsystems_audio_spectrogram-renderer/spectrogram-settings.ts';
import type { PreviewSpectrogramSettings } from './audio-preview-types.ts';

export function resolvePreviewSpectrogramSettings(settings: PreviewSpectrogramSettings, sampleRate: number) {
	return resolveSpectrogramSettings({ ...settings, maxFrequency: settings.maxFrequency ?? sampleRate / 2 }, sampleRate);
}
