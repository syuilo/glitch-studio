import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDisplacement',
	displayName: 'Vector displacement',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		vector: { type: 'vector', label: 'Vector', canNode: true, mim: -1, max: 1, default: () => ({ type: 'literal', value: [0, 0] }) },
		amount: { type: 'range', label: 'Amount', min: -1, max: 1, step: 0.001, default: () => ({ type: 'literal', value: 0.05 }) },
		flipX: { type: 'bool', label: 'Flip X', default: () => ({ type: 'literal', value: false }) },
		flipY: { type: 'bool', label: 'Flip Y', default: () => ({ type: 'literal', value: false }) },
		rotation: { type: 'angle', label: 'Rotation', default: () => ({ type: 'literal', value: 0 }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ type: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
