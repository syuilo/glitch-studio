import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vectorDisplacement',
	displayName: 'Vector displacement',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		vector: { dataType: { kind: 'vector' }, ui: { label: 'Vector', control: { controlType: 'vector', min: -1, max: 1 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: -1, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0.05 } },
		flipX: { dataType: { kind: 'bool' }, ui: { label: 'Flip X', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		flipY: { dataType: { kind: 'bool' }, ui: { label: 'Flip Y', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
