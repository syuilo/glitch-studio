import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioWaveform',
	displayName: 'Audio Waveform',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		player: { dataType: { kind: 'playerReference' }, ui: { label: 'Player', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		channel: {
			dataType: { kind: 'enum', options: ['left', 'right', 'mix', 'stereo'] },
			ui: { label: 'Channel', control: { labels: { 'left': 'Left', 'right': 'Right', 'mix': 'Mix (L + R)', 'stereo': 'Stereo' } } },
			defaultValue: { inputSource: 'literal', value: 'stereo' },
		},
		duration: { dataType: { kind: 'scalar' }, ui: { label: 'Time span (seconds)', control: { controlType: 'range', min: 0.005, max: 1, step: 0.005 } }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		amplitude: { dataType: { kind: 'scalar' }, ui: { label: 'Amplitude', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		lineWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Line width', control: { controlType: 'range', min: 0.001, max: 0.05, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.003 } },
		colorL: { dataType: { kind: 'color' }, ui: { label: 'Color (L)', control: {} }, defaultValue: { inputSource: 'literal', value: [0.2, 0.9, 1, 1] } },
		colorR: { dataType: { kind: 'color' }, ui: { label: 'Color (R)', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 0.3, 0.6, 1] } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
