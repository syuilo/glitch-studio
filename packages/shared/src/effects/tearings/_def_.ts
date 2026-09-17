import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'tearings',
	displayName: 'Tearings',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', min: 0, max: 100, label: 'Amount', default: () => ({ type: 'literal', value: 3 }) },
		strength: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Strength', default: () => ({ type: 'literal', value: 0.02 }) },
		size: { type: 'range', min: 0, max: 100, step: 0.01, label: 'Size', default: () => ({ type: 'literal', value: 20 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ type: 'literal', value: 0 }) },
		channelShift: { type: 'range', min: 0, max: 10, step: 0.01, label: 'Ch shift', default: () => ({ type: 'literal', value: 0.5 }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'expression', expression: 'TIME' }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
