import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'chromaticAberration',
	displayName: 'Chromatic Aberration',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Amount', default: () => ({ type: 'literal', value: 0.1 }) },
		rStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'R strength', default: () => ({ type: 'literal', value: 1 }) },
		gStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'G strength', default: () => ({ type: 'literal', value: 1.5 }) },
		bStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'B strength', default: () => ({ type: 'literal', value: 2 }) },
		samples: { type: 'number', min: 1, max: 100, label: 'Samples', default: () => ({ type: 'literal', value: 32 }) },
		start: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Start', default: () => ({ type: 'literal', value: 0 }) },
		vector: { type: 'vector', step: 0.01, min: -5, max: 5, label: 'Vector', default: () => ({ type: 'literal', value: [0, 0] }) },
		normalize: { type: 'bool', label: 'Normalize', default: () => ({ type: 'literal', value: false }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
