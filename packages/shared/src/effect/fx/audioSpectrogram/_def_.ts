import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioSpectrogram',
	displayName: 'Audio Spectrogram',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		player: { dataType: { kind: 'playerReference' }, ui: { label: 'Player', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		channel: {
			dataType: { kind: 'enum', options: ['left', 'right', 'mix', 'stereo'] },
			ui: { label: 'Channel', control: { labels: { 'left': 'Left', 'right': 'Right', 'mix': 'Mix (L + R)', 'stereo': 'Stereo' } } },
			defaultValue: { inputSource: 'literal', value: 'mix' },
		},
		fftSize: {
			dataType: { kind: 'enum', options: ['256', '512', '1024', '2048', '4096', '8192', '16384', '32768'] },
			ui: { label: 'FFT size', control: { labels: { '256': '256', '512': '512', '1024': '1024', '2048': '2048', '4096': '4096', '8192': '8192', '16384': '16384', '32768': '32768' } } },
			defaultValue: { inputSource: 'literal', value: '2048' },
		},
		window: {
			dataType: { kind: 'enum', options: ['hann', 'hamming', 'blackman', 'rectangular'] },
			ui: { label: 'Window', control: { labels: { 'hann': 'Hann', 'hamming': 'Hamming', 'blackman': 'Blackman', 'rectangular': 'Rectangular' } } },
			defaultValue: { inputSource: 'literal', value: 'hann' },
		},
		smoothing: { dataType: { kind: 'scalar' }, ui: { label: 'Smoothing (seconds)', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		minFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum frequency (Hz)', control: { controlType: 'number', min: 0, max: 96000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 20 } },
		maxFrequency: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum frequency (Hz)', control: { controlType: 'number', min: 1, max: 96000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 20000 } },
		logarithmic: { dataType: { kind: 'bool' }, ui: { label: 'Logarithmic frequency', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		minDb: { dataType: { kind: 'scalar' }, ui: { label: 'Minimum dB', control: { controlType: 'range', min: -120, max: -1, step: 1 } }, defaultValue: { inputSource: 'literal', value: -80 } },
		maxDb: { dataType: { kind: 'scalar' }, ui: { label: 'Maximum dB', control: { controlType: 'range', min: -60, max: 20, step: 1 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		duration: { dataType: { kind: 'scalar' }, ui: { label: 'Time span (seconds)', control: { controlType: 'range', min: 0.5, max: 60, step: 0.5 } }, defaultValue: { inputSource: 'literal', value: 10 } },
		orientation: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Time axis', control: { labels: { 'horizontal': 'Horizontal', 'vertical': 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		direction: {
			dataType: { kind: 'enum', options: ['forward', 'reverse'] },
			ui: { label: 'Flow direction', control: { labels: { 'forward': 'Right to left / Top to bottom', 'reverse': 'Left to right / Bottom to top' } } },
			defaultValue: { inputSource: 'literal', value: 'forward' },
		},
		flipFrequency: { dataType: { kind: 'bool' }, ui: { label: 'Reverse frequency axis', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
