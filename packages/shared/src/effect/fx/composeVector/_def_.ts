import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVector',
	displayName: 'Compose Vector',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		x: { dataType: { kind: 'scalar' }, ui: { label: 'X', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: { kind: 'scalar' }, ui: { label: 'Y', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'vector' } },
	},
});
