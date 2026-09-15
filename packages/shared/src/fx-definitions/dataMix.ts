import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'dataMix',
	displayName: 'Mix (Data)',
	tags: [],
	paramDefs: {
		inputA: { type: 'node', label: 'A', dataType: 'any', primary: true, default: () => ({ type: 'literal', value: null }) },
		inputB: { type: 'node', label: 'B', dataType: 'any', default: () => ({ type: 'literal', value: null }) },
		fitModeA: { type: 'fitMode', label: 'A fit mode', default: () => ({ type: 'literal', value: 'cover' }) },
		fitModeB: { type: 'fitMode', label: 'B fit mode', default: () => ({ type: 'literal', value: 'cover' }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ type: 'literal', value: 0.5 }) },
		fitModeAmount: { type: 'fitMode', label: 'Amount fit mode', default: () => ({ type: 'literal', value: 'stretch' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'any' },
	},
});
