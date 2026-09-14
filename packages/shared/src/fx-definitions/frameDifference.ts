import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'frameDifference',
	displayName: 'Frame difference',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		mode: { type: 'enum', label: 'Mode', options: [
			{ label: 'RGB', value: 'rgb' },
			{ label: 'Luminance', value: 'luminance' },
		], default: () => ({ type: 'literal', value: 'rgb' }) },
		gain: { type: 'range', label: 'Gain', min: 0, max: 10, step: 0.01, default: () => ({ type: 'literal', value: 1 }) },
		threshold: { type: 'range', label: 'Threshold', min: 0, max: 1, step: 0.001, default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
