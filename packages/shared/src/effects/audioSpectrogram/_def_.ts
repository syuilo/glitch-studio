import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioSpectrogram',
	displayName: 'Audio Spectrogram',
	tags: [],
	paramDefs: {
		player: { dataType: 'playerReference', ui: { label: 'Player', control: 'player' }, defaultValue: { inputSource: 'literal', value: null } },
		channel: { dataType: 'enum', ui: { label: 'Channel', control: 'enum' }, options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], defaultValue: { inputSource: 'literal', value: 'mix' } },
		fftSize: { dataType: 'enum', ui: { label: 'FFT size', control: 'enum' }, options: [
			{ label: '256', value: 256 }, { label: '512', value: 512 },
			{ label: '1024', value: 1024 }, { label: '2048', value: 2048 },
			{ label: '4096', value: 4096 }, { label: '8192', value: 8192 },
			{ label: '16384', value: 16384 }, { label: '32768', value: 32768 },
		], defaultValue: { inputSource: 'literal', value: 2048 } },
		window: { dataType: 'enum', ui: { label: 'Window', control: 'enum' }, options: [
			{ label: 'Hann', value: 'hann' }, { label: 'Hamming', value: 'hamming' },
			{ label: 'Blackman', value: 'blackman' }, { label: 'Rectangular', value: 'rectangular' },
		], defaultValue: { inputSource: 'literal', value: 'hann' } },
		smoothing: { dataType: 'scalar', ui: { label: 'Smoothing (seconds)', control: 'range', min: 0, max: 2, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		minFrequency: { dataType: 'scalar', ui: { label: 'Minimum frequency (Hz)', control: 'number', min: 0, max: 96000, step: 1 }, defaultValue: { inputSource: 'literal', value: 20 } },
		maxFrequency: { dataType: 'scalar', ui: { label: 'Maximum frequency (Hz)', control: 'number', min: 1, max: 96000, step: 1 }, defaultValue: { inputSource: 'literal', value: 20000 } },
		logarithmic: { dataType: 'bool', ui: { label: 'Logarithmic frequency', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		minDb: { dataType: 'scalar', ui: { label: 'Minimum dB', control: 'range', min: -120, max: -1, step: 1 }, defaultValue: { inputSource: 'literal', value: -80 } },
		maxDb: { dataType: 'scalar', ui: { label: 'Maximum dB', control: 'range', min: -60, max: 20, step: 1 }, defaultValue: { inputSource: 'literal', value: 0 } },
		duration: { dataType: 'scalar', ui: { label: 'Time span (seconds)', control: 'range', min: 0.5, max: 60, step: 0.5 }, defaultValue: { inputSource: 'literal', value: 10 } },
		orientation: { dataType: 'enum', ui: { label: 'Time axis', control: 'enum' }, options: [
			{ label: 'Horizontal', value: 'horizontal' }, { label: 'Vertical', value: 'vertical' },
		], defaultValue: { inputSource: 'literal', value: 'horizontal' } },
		direction: { dataType: 'enum', ui: { label: 'Flow direction', control: 'enum' }, options: [
			{ label: 'Right to left / Top to bottom', value: 'forward' },
			{ label: 'Left to right / Bottom to top', value: 'reverse' },
		], defaultValue: { inputSource: 'literal', value: 'forward' } },
		flipFrequency: { dataType: 'bool', ui: { label: 'Reverse frequency axis', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
