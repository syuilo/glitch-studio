import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'testStructArray',
	displayName: 'Test of Struct and Array',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		foo: {
			dataType: { kind: 'struct', fields: { node: { kind: 'color' } } },
			ui: { label: 'Foo', control: { fields: { node: { label: 'Node', control: {} } } } },
			defaultValue: { inputSource: 'literal', value: { node: { inputSource: 'node', nodeId: null, outputPort: null } } },
			fields: { node: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } } },
		},
		bars: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Bars', control: { element: {} } },
			defaultValue: { inputSource: 'literal', value: [] },
			element: { defaultValue: { inputSource: 'literal', value: [0, 1, 0, 1] } },
		},
		buzzs: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: { image: { kind: 'color' }, x: { kind: 'scalar' }, y: { kind: 'scalar' } } } },
			ui: {
				label: 'Buzzs',
				control: {
					element: {
						fields: { image: { label: 'Image', control: {} }, x: { label: 'X', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, y: { label: 'Y', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } } },
					},
				},
			},
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ inputSource: 'literal', value: { image: { inputSource: 'literal', value: [0, 0, 1, 1] }, x: { inputSource: 'literal', value: 0 }, y: { inputSource: 'literal', value: 0 } } },
				],
			},
			element: {
				defaultValue: { inputSource: 'literal', value: { image: { inputSource: 'literal', value: [0, 0, 1, 1] }, x: { inputSource: 'literal', value: 0 }, y: { inputSource: 'literal', value: 0 } } },
				fields: { image: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 1, 1] } }, x: { defaultValue: { inputSource: 'literal', value: 0 } }, y: { defaultValue: { inputSource: 'literal', value: 0 } } },
			},
		},
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
		output2: { primary: false, dataType: { kind: 'scalar' } },
		output3: { primary: false, dataType: { kind: 'vector' } },
	},
});
