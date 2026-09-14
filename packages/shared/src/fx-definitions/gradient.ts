import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'gradient',
	displayName: 'Gradient',
	paramDefs: {
		startValue: { type: 'number', step: 0.01, label: 'Start Value', default: () => ({ type: 'literal', value: 0 }) },
		endValue: { type: 'number', step: 0.01, label: 'End Value', default: () => ({ type: 'literal', value: 1 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ type: 'literal', value: 0 }) },
		interpolation: {
			type: 'enum', label: 'Interpolation',
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'easing', label: 'Easing' },
			],
			default: () => ({ type: 'literal', value: 'linear' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
