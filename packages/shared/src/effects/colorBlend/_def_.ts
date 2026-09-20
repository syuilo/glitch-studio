import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlend',
	displayName: 'Blend (Color)',
	tags: [],
	paramDefs: {
		inputA: { type: 'color', canNode: true, label: 'A', primary: true, default: () => ({ inputSource: 'literal', value: null }) },
		inputB: { type: 'color', canNode: true, label: 'B', default: () => ({ inputSource: 'literal', value: null }) },
		fitModeA: { type: 'fitMode', label: 'A fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		fitModeB: { type: 'fitMode', label: 'B fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		fitModeAmount: { type: 'fitMode', label: 'Amount fit mode', default: () => ({ inputSource: 'literal', value: 'stretch' }) },
		blendMode: { type: 'blendMode', label: 'Blend mode', default: () => ({ inputSource: 'literal', value: 'add' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
