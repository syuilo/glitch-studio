import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioSpectrogram',
	displayName: 'Audio Spectrogram',
	tags: [],
	paramDefs: {
		player: { dataType: 'playerReference', ui: { control: 'player' }, label: 'Player', default: () => ({ inputSource: 'literal', value: null }) },
		channel: { dataType: 'enum', ui: { control: 'enum' }, label: 'Channel', options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], default: () => ({ inputSource: 'literal', value: 'mix' }) },
		fftSize: { dataType: 'enum', ui: { control: 'enum' }, label: 'FFT size', options: [
			{ label: '256', value: 256 }, { label: '512', value: 512 },
			{ label: '1024', value: 1024 }, { label: '2048', value: 2048 },
			{ label: '4096', value: 4096 }, { label: '8192', value: 8192 },
			{ label: '16384', value: 16384 }, { label: '32768', value: 32768 },
		], default: () => ({ inputSource: 'literal', value: 2048 }) },
		window: { dataType: 'enum', ui: { control: 'enum' }, label: 'Window', options: [
			{ label: 'Hann', value: 'hann' }, { label: 'Hamming', value: 'hamming' },
			{ label: 'Blackman', value: 'blackman' }, { label: 'Rectangular', value: 'rectangular' },
		], default: () => ({ inputSource: 'literal', value: 'hann' }) },
		smoothing: { dataType: 'number', ui: { control: 'range', min: 0, max: 2, step: 0.01 }, label: 'Smoothing (seconds)', default: () => ({ inputSource: 'literal', value: 0 }) },
		minFrequency: { dataType: 'number', ui: { control: 'number', min: 0, max: 96000, step: 1 }, label: 'Minimum frequency (Hz)', default: () => ({ inputSource: 'literal', value: 20 }) },
		maxFrequency: { dataType: 'number', ui: { control: 'number', min: 1, max: 96000, step: 1 }, label: 'Maximum frequency (Hz)', default: () => ({ inputSource: 'literal', value: 20000 }) },
		logarithmic: { dataType: 'bool', ui: { control: 'bool' }, label: 'Logarithmic frequency', default: () => ({ inputSource: 'literal', value: false }) },
		minDb: { dataType: 'number', ui: { control: 'range', min: -120, max: -1, step: 1 }, label: 'Minimum dB', default: () => ({ inputSource: 'literal', value: -80 }) },
		maxDb: { dataType: 'number', ui: { control: 'range', min: -60, max: 20, step: 1 }, label: 'Maximum dB', default: () => ({ inputSource: 'literal', value: 0 }) },
		duration: { dataType: 'number', ui: { control: 'range', min: 0.5, max: 60, step: 0.5 }, label: 'Time span (seconds)', default: () => ({ inputSource: 'literal', value: 10 }) },
		orientation: { dataType: 'enum', ui: { control: 'enum' }, label: 'Time axis', options: [
			{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' },
		], default: () => ({ inputSource: 'literal', value: 'horizontal' }) },
		direction: { dataType: 'enum', ui: { control: 'enum' }, label: 'Flow direction', options: [
			{ label: 'Right to left / Top to bottom', value: 'forward' },
			{ label: 'Left to right / Bottom to top', value: 'reverse' },
		], default: () => ({ inputSource: 'literal', value: 'forward' }) },
		flipFrequency: { dataType: 'bool', ui: { control: 'bool' }, label: 'Reverse frequency axis', default: () => ({ inputSource: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
