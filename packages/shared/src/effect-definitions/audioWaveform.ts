import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'audioWaveform',
	displayName: 'Audio Waveform',
	tags: [],
	paramDefs: {
		player: { type: 'player', label: 'Player', default: () => ({ type: 'literal', value: null }) },
		channel: { type: 'enum', label: 'Channel', options: [
			{ label: 'Left', value: 'left' }, { label: 'Right', value: 'right' },
			{ label: 'Mix (L + R)', value: 'mix' }, { label: 'Stereo', value: 'stereo' },
		], default: () => ({ type: 'literal', value: 'stereo' }) },
		duration: { type: 'range', label: 'Time span (seconds)', min: 0.005, max: 1, step: 0.005, default: () => ({ type: 'literal', value: 0.05 }) },
		amplitude: { type: 'range', label: 'Amplitude', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		lineWidth: { type: 'range', label: 'Line width', min: 0.001, max: 0.05, step: 0.001, default: () => ({ type: 'literal', value: 0.003 }) },
		color: { type: 'color', label: 'Color (L)', default: () => ({ type: 'literal', value: [0.2, 0.9, 1, 1] }) },
		rightColor: { type: 'color', label: 'Color (R)', default: () => ({ type: 'literal', value: [1, 0.3, 0.6, 1] }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
