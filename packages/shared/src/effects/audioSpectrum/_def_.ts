import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioSpectrum',
	displayName: 'Audio Spectrum',
	tags: [],
	paramDefs: {
		player: { type: 'player', label: 'Player', default: () => ({ inputSource: 'literal', value: null }) },
		channel: { type: 'enum', label: 'Channel', options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], default: () => ({ inputSource: 'literal', value: 'stereo' }) },
		fftSize: { type: 'enum', label: 'FFT size', options: [
			{ label: '256', value: 256 }, { label: '512', value: 512 },
			{ label: '1024', value: 1024 }, { label: '2048', value: 2048 },
			{ label: '4096', value: 4096 }, { label: '8192', value: 8192 },
			{ label: '16384', value: 16384 }, { label: '32768', value: 32768 },
		], default: () => ({ inputSource: 'literal', value: 2048 }) },
		window: { type: 'enum', label: 'Window', options: [
			{ label: 'Hann', value: 'hann' }, { label: 'Hamming', value: 'hamming' },
			{ label: 'Blackman', value: 'blackman' }, { label: 'Rectangular', value: 'rectangular' },
		], default: () => ({ inputSource: 'literal', value: 'hann' }) },
		smoothing: { type: 'range', label: 'Smoothing (seconds)', min: 0, max: 2, step: 0.01, default: () => ({ inputSource: 'literal', value: 0.15 }) },
		minFrequency: { type: 'number', label: 'Minimum frequency (Hz)', min: 0, max: 96000, step: 1, default: () => ({ inputSource: 'literal', value: 20 }) },
		maxFrequency: { type: 'number', label: 'Maximum frequency (Hz)', min: 1, max: 96000, step: 1, default: () => ({ inputSource: 'literal', value: 20000 }) },
		logarithmic: { type: 'bool', label: 'Logarithmic frequency', default: () => ({ inputSource: 'literal', value: false }) },
		minDb: { type: 'range', label: 'Minimum dB', min: -120, max: -1, step: 1, default: () => ({ inputSource: 'literal', value: -80 }) },
		maxDb: { type: 'range', label: 'Maximum dB', min: -60, max: 20, step: 1, default: () => ({ inputSource: 'literal', value: 0 }) },
		color: { type: 'color', label: 'Color (L)', default: () => ({ inputSource: 'literal', value: [0.2, 0.9, 1, 1] }) },
		rightColor: { type: 'color', label: 'Color (R)', default: () => ({ inputSource: 'literal', value: [1, 0.3, 0.6, 1] }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
