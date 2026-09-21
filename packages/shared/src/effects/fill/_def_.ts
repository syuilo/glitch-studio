import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	tags: [],
	paramDefs: {
		color: { dataType: 'color', ui: { label: 'Color', control: 'color' }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
