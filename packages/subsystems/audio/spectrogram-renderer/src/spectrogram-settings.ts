import { audioChannel, finiteNumber } from '@gs/subsystems_audio_renderer/audio-spectrum.ts';

export type SpectrogramSettings = {
	channel: 'left' | 'right' | 'mix' | 'stereo';
	fftSize: 256 | 512 | 1024 | 2048 | 4096 | 8192 | 16384 | 32768;
	window: 'hann' | 'hamming' | 'blackman' | 'rectangular';
	smoothing: number;
	minFrequency: number;
	maxFrequency: number;
	logarithmic: boolean;
	minDb: number;
	maxDb: number;
	duration: number;
	orientation: 'horizontal' | 'vertical';
	direction: 'forward' | 'reverse';
	flipFrequency: boolean;
};

/** 解析計画・目盛り・GPU描画が同じ範囲を使うように値を確定する。 */
export function resolveSpectrogramSettings(settings: SpectrogramSettings, sampleRate: number): SpectrogramSettings {
	const fftSize = 2 ** Math.round(Math.log2(finiteNumber(settings.fftSize, 2048, 256, 32768))) as SpectrogramSettings['fftSize'];
	const minFrequency = finiteNumber(settings.minFrequency, 20, settings.logarithmic ? 1 : 0, sampleRate / 2 - 1);
	const minDb = finiteNumber(settings.minDb, -80, -120, -1);
	return {
		...settings,
		fftSize,
		channel: audioChannel(settings.channel),
		smoothing: finiteNumber(settings.smoothing, 0, 0, 2),
		duration: finiteNumber(settings.duration, 10, 0.5, 60),
		minFrequency,
		maxFrequency: finiteNumber(settings.maxFrequency, 20000, minFrequency + 1, sampleRate / 2),
		minDb,
		maxDb: finiteNumber(settings.maxDb, 0, minDb + 1, 20),
	};
}
