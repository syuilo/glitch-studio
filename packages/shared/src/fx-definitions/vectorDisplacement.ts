import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'vectorDisplacement',
	displayName: 'Vector displacement',
	category: 'effect',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		vector: { type: 'node', label: 'Vector', dataType: 'vector', default: () => ({ type: 'literal', value: null }) },
		amount: { type: 'range', label: 'Amount', min: -1, max: 1, step: 0.001, default: () => ({ type: 'literal', value: 0.05 }) },
		flipX: { type: 'bool', label: 'Flip X', default: () => ({ type: 'literal', value: false }) },
		flipY: { type: 'bool', label: 'Flip Y', default: () => ({ type: 'literal', value: false }) },
		rotation: { type: 'range', label: 'Rotation (deg)', min: -180, max: 180, step: 0.1, default: () => ({ type: 'literal', value: 0 }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
