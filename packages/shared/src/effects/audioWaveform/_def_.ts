import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'audioWaveform',
	displayName: 'Audio Waveform',
	tags: [],
	paramDefs: {
		player: { dataType: 'playerReference', ui: { control: 'player' }, label: 'Player', default: () => ({ inputSource: 'literal', value: null }) },
		channel: { dataType: 'enum', ui: { control: 'enum' }, label: 'Channel', options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], default: () => ({ inputSource: 'literal', value: 'stereo' as const }) },
		duration: { dataType: 'scalar', ui: { control: 'range', min: 0.005, max: 1, step: 0.005 }, label: 'Time span (seconds)', default: () => ({ inputSource: 'literal', value: 0.05 }) },
		amplitude: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Amplitude', default: () => ({ inputSource: 'literal', value: 1 }) },
		lineWidth: { dataType: 'scalar', ui: { control: 'range', min: 0.001, max: 0.05, step: 0.001 }, label: 'Line width', default: () => ({ inputSource: 'literal', value: 0.003 }) },
		colorL: { dataType: 'color', ui: { control: 'color' }, label: 'Color (L)', default: () => ({ inputSource: 'literal', value: [0.2, 0.9, 1, 1] }) },
		colorR: { dataType: 'color', ui: { control: 'color' }, label: 'Color (R)', default: () => ({ inputSource: 'literal', value: [1, 0.3, 0.6, 1] }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
