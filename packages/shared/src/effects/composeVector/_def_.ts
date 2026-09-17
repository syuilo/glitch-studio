import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVector',
	displayName: 'Compose Vector',
	tags: [],
	paramDefs: {
		x: { type: 'number', label: 'X', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0 }) },
		y: { type: 'number', label: 'Y', step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
