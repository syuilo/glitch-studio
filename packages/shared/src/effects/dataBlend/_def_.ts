import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dataBlend',
	displayName: 'Blend (Data)',
	tags: [],
	paramDefs: {
		inputA: { type: 'node', label: 'A', dataType: 'any', primary: true, default: () => ({ inputSource: 'literal', value: null }) },
		inputB: { type: 'node', label: 'B', dataType: 'any', default: () => ({ inputSource: 'literal', value: null }) },
		fitModeA: { type: 'fitMode', label: 'A fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		fitModeB: { type: 'fitMode', label: 'B fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		fitModeAmount: { type: 'fitMode', label: 'Amount fit mode', default: () => ({ inputSource: 'literal', value: 'stretch' }) },
		blendMode: { type: 'blendMode', label: 'Blend mode', default: () => ({ inputSource: 'literal', value: 'add' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'any' },
	},
});
