import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'transform',
	displayName: 'Transform',
	category: 'effect',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		translation: { type: 'vector', label: 'Translation', min: -1, max: 1, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: [0, 0] }) },
		scale: { type: 'vector', label: 'Scale', min: 0, max: 4, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: [1, 1] }) },
		rotation: { type: 'range', label: 'Rotation (deg)', min: -180, max: 180, step: 0.1, canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		wrap: {
			type: 'enum', label: 'Wrap', canNode: false,
			options: [
				{ value: 'transparent', label: 'Transparent' },
				{ value: 'clampToEdge', label: 'Clamp to edge' },
				{ value: 'repeat', label: 'Repeat' },
				{ value: 'repeatMirrored', label: 'Repeat (Mirrored)' },
			],
			default: () => ({ type: 'literal', value: 'transparent' }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
