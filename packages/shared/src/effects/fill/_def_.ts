import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'fill',
	displayName: 'Fill',
	tags: [],
	paramDefs: {
		color: { type: 'color', label: 'Color', default: () => ({ type: 'literal', value: [1, 1, 1, 1] }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
