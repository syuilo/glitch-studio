import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'rainDropsOnWindow2',
	displayName: 'Rain Drops On Window (Type 2)',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		density: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Density', default: () => ({ type: 'literal', value: 0.5 }) },
		time: { type: 'number', step: 0.01, label: 'Time (s)', default: () => ({ type: 'expression', expression: 'TIME' }) },
		scale: { type: 'range', min: 0.1, max: 5, step: 0.01, label: 'Scale', default: () => ({ type: 'literal', value: 1 }) },
		refraction: { type: 'range', min: 0, max: 2, step: 0.01, label: 'Refraction', default: () => ({ type: 'literal', value: 0.6 }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
