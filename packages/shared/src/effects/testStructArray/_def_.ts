import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'testStructArray',
	displayName: 'Test of Struct and Array',
	tags: [],
	paramDefs: {
		foo: {
			dataType: 'struct',
			label: 'Foo',
			fields: {
				node: { dataType: 'color', ui: { control: 'color' }, canNode: true, label: 'Node', default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
			},
			default: () => ({
				inputSource: 'literal',
				value: {
					node: { type: 'node', nodeId: null, outputPort: null },
				},
			}),
		},
		bars: {
			dataType: 'array',
			label: 'Bars',
			item: {
				dataType: 'color', ui: { control: 'color' },
				label: 'Bar',
				default: () => ({ inputSource: 'literal', value: [0, 1, 0, 1] }),
			},
			default: () => ({
				inputSource: 'literal',
				value: [],
			}),
		},
		buzzs: {
			dataType: 'array',
			label: 'Buzzs',
			item: {
				dataType: 'struct',
				label: 'Buzz',
				fields: {
					image: { dataType: 'color', ui: { control: 'color' }, canNode: true, label: 'Image', default: () => ({ inputSource: 'literal', value: [0, 0, 1, 1] }) },
					x: { dataType: 'scalar', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'X', default: () => ({ inputSource: 'literal', value: 0 }) },
					y: { dataType: 'scalar', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Y', default: () => ({ inputSource: 'literal', value: 0 }) },
				},
				default: () => ({
					inputSource: 'literal',
					value: {
						image: { inputSource: 'literal', value: [0, 0, 1, 1] },
						x: { inputSource: 'literal', value: 0 },
						y: { inputSource: 'literal', value: 0 },
					},
				}),
			},
			default: () => ({
				inputSource: 'literal',
				value: [{
					inputSource: 'literal',
					value: {
						image: { inputSource: 'literal', value: [0, 0, 1, 1] },
						x: { inputSource: 'literal', value: 0 },
						y: { inputSource: 'literal', value: 0 },
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
