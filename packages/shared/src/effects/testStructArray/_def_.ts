import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'testStructArray',
	displayName: 'Test of Struct and Array',
	tags: [],
	paramDefs: {
		foo: {
			type: 'struct',
			label: 'Foo',
			fields: {
				node: { type: 'color', canNode: true, label: 'Node', default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
			},
			default: () => ({
				type: 'literal',
				value: {
					node: { type: 'node', nodeId: null, outputPort: null },
				},
			}),
		},
		bars: {
			type: 'array',
			label: 'Bars',
			item: {
				type: 'color',
				label: 'Bar',
				default: () => ({ type: 'literal', value: [0, 1, 0, 1] }),
			},
			default: () => ({
				type: 'literal',
				value: [],
			}),
		},
		buzzs: {
			type: 'array',
			label: 'Buzzs',
			item: {
				type: 'struct',
				label: 'Buzz',
				fields: {
					image: { type: 'color', canNode: true, label: 'Image', default: () => ({ type: 'literal', value: [0, 0, 1, 1] }) },
					x: { type: 'range', min: -1, max: 1, step: 0.01, label: 'X', default: () => ({ type: 'literal', value: 0 }) },
					y: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Y', default: () => ({ type: 'literal', value: 0 }) },
				},
				default: () => ({
					type: 'literal',
					value: {
						image: { type: 'literal', value: [0, 0, 1, 1] },
						x: { type: 'literal', value: 0 },
						y: { type: 'literal', value: 0 },
					},
				}),
			},
			default: () => ({
				type: 'literal',
				value: [{
					type: 'literal',
					value: {
						image: { type: 'literal', value: [0, 0, 1, 1] },
						x: { type: 'literal', value: 0 },
						y: { type: 'literal', value: 0 },
					},
				}],
			}),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
		output2: { primary: false, dataType: 'scalar' },
		output3: { primary: false, dataType: 'vector' },
	},
});
