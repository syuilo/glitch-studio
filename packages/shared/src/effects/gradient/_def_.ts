import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'gradient',
	displayName: 'Gradient',
	tags: [],
	paramDefs: {
		fitMode: { type: 'fitMode', label: 'Fit mode', default: () => ({ type: 'literal', value: 'cover' }) },
		startPosition: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Start Position', canNode: true, default: () => ({ type: 'literal', value: -1 }) },
		endPosition: { type: 'range', min: -1, max: 1, step: 0.01, label: 'End Position', canNode: true, default: () => ({ type: 'literal', value: 1 }) },
		startValue: { type: 'number', step: 0.01, label: 'Start Value', canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		endValue: { type: 'number', step: 0.01, label: 'End Value', canNode: true, default: () => ({ type: 'literal', value: 1 }) },
		clampEdge: { type: 'bool', label: 'Clamp to edge', default: () => ({ type: 'literal', value: true }) },
		frequency: { type: 'number', step: 0.01, label: 'Frequency', canNode: true, default: () => ({ type: 'literal', value: 1 }) },
		mirrorRepeat: { type: 'bool', label: 'Mirror Repeat', default: () => ({ type: 'literal', value: false }) },
		phase: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Phase', canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ type: 'literal', value: 0 }) },
		interpolation: {
			type: 'enum', label: 'Interpolation',
			options: [
				{ value: 'linear', label: 'Linear' },
				{ value: 'smoothstep', label: 'Smoothstep' },
				{ value: 'smootherstep', label: 'Smootherstep' },
				{ value: 'cosine', label: 'Cosine' },
				{ value: 'circular', label: 'Circular' },
				{ value: 'back', label: 'Back' },
				{ value: 'elastic', label: 'Elastic' },
				{ value: 'expo', label: 'Expo' },
				{ value: 'expo-in', label: 'Expo In' },
				{ value: 'expo-out', label: 'Expo Out' },
			],
			default: () => ({ type: 'literal', value: 'linear' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
