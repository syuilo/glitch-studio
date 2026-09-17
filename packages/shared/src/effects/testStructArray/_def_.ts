import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'testStructArray',
	displayName: 'Test of Struct and Array',
	tags: [],
	paramDefs: {
		inputs: {
			type: 'struct',
			label: 'Inputs',
			array: true,
			fields: {
				image: { type: 'color', canNode: true, label: 'Image', default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
				x: { type: 'range', min: -1, max: 1, step: 0.01, label: 'X', default: () => ({ type: 'literal', value: 0 }) },
				y: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Y', default: () => ({ type: 'literal', value: 0 }) },
			},
			default: () => ([{
				type: 'literal',
				value: {
					image: { type: 'node', nodeId: null, outputPort: null },
					x: { type: 'literal', value: 0 },
					y: { type: 'literal', value: 0 },
				},
			}]),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
