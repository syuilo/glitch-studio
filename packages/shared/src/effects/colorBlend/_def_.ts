import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlend',
	displayName: 'Blend (Color)',
	tags: [],
	paramDefs: {
		inputA: { dataType: 'color', ui: { control: 'color' }, canNode: true, label: 'A', primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		inputB: { dataType: 'color', ui: { control: 'color' }, canNode: true, label: 'B', default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		fitModeA: { dataType: 'fitMode', ui: { control: 'fitMode' }, label: 'A fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		fitModeB: { dataType: 'fitMode', ui: { control: 'fitMode' }, label: 'B fit mode', default: () => ({ inputSource: 'literal', value: 'cover' }) },
		amount: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Amount', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		fitModeAmount: { dataType: 'fitMode', ui: { control: 'fitMode' }, label: 'Amount fit mode', default: () => ({ inputSource: 'literal', value: 'stretch' }) },
		blendMode: { dataType: 'blendMode', ui: { control: 'blendMode' }, label: 'Blend mode', default: () => ({ inputSource: 'literal', value: 'add' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
