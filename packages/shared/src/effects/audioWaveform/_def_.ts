import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioWaveform',
	displayName: 'Audio Waveform',
	tags: [],
	paramDefs: {
		player: { dataType: 'playerReference', ui: { label: 'Player', control: 'player' }, defaultValue: { inputSource: 'literal', value: null } },
		channel: { dataType: 'enum', ui: { label: 'Channel', control: 'enum' }, options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], defaultValue: { inputSource: 'literal', value: 'stereo' as const } },
		duration: { dataType: 'scalar', ui: { label: 'Time span (seconds)', control: 'range', min: 0.005, max: 1, step: 0.005 }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		amplitude: { dataType: 'scalar', ui: { label: 'Amplitude', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		lineWidth: { dataType: 'scalar', ui: { label: 'Line width', control: 'range', min: 0.001, max: 0.05, step: 0.001 }, defaultValue: { inputSource: 'literal', value: 0.003 } },
		colorL: { dataType: 'color', ui: { label: 'Color (L)', control: 'color' }, defaultValue: { inputSource: 'literal', value: [0.2, 0.9, 1, 1] } },
		colorR: { dataType: 'color', ui: { label: 'Color (R)', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 0.3, 0.6, 1] } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
