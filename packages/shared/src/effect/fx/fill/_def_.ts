import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	tags: [],
	paramDefs: {
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	primaryInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
