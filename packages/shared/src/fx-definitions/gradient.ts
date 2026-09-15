import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'gradient',
	displayName: 'Gradient',
	paramDefs: {
		startPosition: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Start Position', default: () => ({ type: 'literal', value: -1 }) },
		endPosition: { type: 'range', min: -1, max: 1, step: 0.01, label: 'End Position', default: () => ({ type: 'literal', value: 1 }) },
		startValue: { type: 'number', step: 0.01, label: 'Start Value', default: () => ({ type: 'literal', value: 0 }) },
		endValue: { type: 'number', step: 0.01, label: 'End Value', default: () => ({ type: 'literal', value: 1 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ type: 'literal', value: 0 }) },
		interpolation: {
			type: 'enum', label: 'Interpolation',
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'smoothstep', label: 'Smoothstep' },
				{ value: 'smootherstep', label: 'Smootherstep' },
			],
			default: () => ({ type: 'literal', value: 'linear' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
