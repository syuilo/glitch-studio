import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'testStructArray',
	displayName: 'Test of Struct and Array',
	tags: [],
	paramDefs: {
		foo: {
			dataType: 'struct',
			ui: { label: 'Foo' },
			fields: {
				node: { dataType: 'color', ui: { label: 'Node', control: 'color' }, canNode: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
			},
			defaultValue: {
				inputSource: 'literal',
				value: {
					node: { inputSource: 'node', nodeId: null, outputPort: null },
				},
			},
		},
		bars: {
			dataType: 'array',
			ui: { label: 'Bars' },
			item: {
				dataType: 'color', ui: { label: 'Bar', control: 'color' },
				defaultValue: { inputSource: 'literal', value: [0, 1, 0, 1] },
			},
			defaultValue: {
				inputSource: 'literal',
				value: [],
			},
		},
		buzzs: {
			dataType: 'array',
			ui: { label: 'Buzzs' },
			item: {
				dataType: 'struct',
				ui: { label: 'Buzz' },
				fields: {
					image: { dataType: 'color', ui: { label: 'Image', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 1, 1] } },
					x: { dataType: 'scalar', ui: { label: 'X', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
					y: { dataType: 'scalar', ui: { label: 'Y', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
				},
				defaultValue: {
					inputSource: 'literal',
					value: {
						image: { inputSource: 'literal', value: [0, 0, 1, 1] },
						x: { inputSource: 'literal', value: 0 },
						y: { inputSource: 'literal', value: 0 },
					},
				},
			},
			defaultValue: {
				inputSource: 'literal',
				value: [{
					inputSource: 'literal',
					value: {
						image: { inputSource: 'literal', value: [0, 0, 1, 1] },
						x: { inputSource: 'literal', value: 0 },
						y: { inputSource: 'literal', value: 0 },
					},
				}],
			},
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
		output2: { primary: false, dataType: 'scalar' },
		output3: { primary: false, dataType: 'vector' },
	},
});
