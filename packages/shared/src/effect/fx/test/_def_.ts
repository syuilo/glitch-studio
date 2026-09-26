import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'test',
	displayName: 'test',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		x: { dataType: { kind: 'scalar' }, ui: { label: 'X', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: { kind: 'scalar' }, ui: { label: 'Y', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
