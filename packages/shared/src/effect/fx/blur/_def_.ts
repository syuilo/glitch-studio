import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blur',
	displayName: 'Blur',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		radius: { dataType: { kind: 'vector' }, ui: { label: 'Radius', control: { controlType: 'vector', min: 0, max: 1, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0.25, 0.25] } },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'range', min: 4, max: 256, step: 1 } }, defaultValue: { inputSource: 'literal', value: 32 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
