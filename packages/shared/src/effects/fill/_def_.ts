import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	tags: [],
	paramDefs: {
		color: { dataType: 'color', ui: { control: 'color' }, label: 'Color', default: () => ({ inputSource: 'literal', value: [1, 1, 1, 1] }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
