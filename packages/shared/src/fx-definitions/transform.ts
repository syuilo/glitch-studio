import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'transform',
	displayName: 'Transform',
	category: 'effect',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		translation: { type: 'vector', label: 'Translation', min: -1, max: 1, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: [0, 0] }) },
		scale: { type: 'vector', label: 'Scale', min: -1, max: 4, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: [1, 1] }) },
		rotation: { type: 'angle', label: 'Rotation', canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		wrap: {
			type: 'wrapMode', label: 'Wrap', canNode: false, canTransparent: true,
			default: () => ({ type: 'literal', value: 'transparent' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
