import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		color: { dataType: 'color', ui: { label: 'Color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
