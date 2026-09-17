import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow1',
	displayName: 'Rain Drops On Window (Type 1)',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		density: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Density', default: () => ({ type: 'literal', value: 0.6 }) },
		refraction: { type: 'range', min: 0, max: 2, step: 0.01, label: 'Refraction', default: () => ({ type: 'literal', value: 0.8 }) },
		fog: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Fog', default: () => ({ type: 'literal', value: 0.35 }) },
		time: { type: 'number', step: 0.01, label: 'Time (s)', default: () => ({ type: 'expression', expression: 'TIME' }) },
		scale: { type: 'range', min: 0.1, max: 5, step: 0.01, label: 'Scale', default: () => ({ type: 'literal', value: 1 }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
