import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorMix',
	displayName: 'Mix (Color)',
	tags: [],
	paramDefs: {
		inputA: { type: 'color', canNode: true, label: 'A', primary: true, default: () => ({ type: 'literal', value: null }) },
		inputB: { type: 'color', canNode: true, label: 'B', default: () => ({ type: 'literal', value: null }) },
		fitModeA: { type: 'fitMode', label: 'A fit mode', default: () => ({ type: 'literal', value: 'cover' }) },
		fitModeB: { type: 'fitMode', label: 'B fit mode', default: () => ({ type: 'literal', value: 'cover' }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0.5 }) },
		fitModeAmount: { type: 'fitMode', label: 'Amount fit mode', default: () => ({ type: 'literal', value: 'stretch' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
