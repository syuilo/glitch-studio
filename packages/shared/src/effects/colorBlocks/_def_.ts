import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlocks',
	displayName: 'Color blocks',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'number', ui: { control: 'range', min: 0, max: 100, step: 1 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: 50 }) },
		alphaRandomness: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Alpha randomness', default: () => ({ inputSource: 'literal', value: 1 }) },
		size: { dataType: 'vector', ui: { control: 'vector', min: 0, max: 1, step: 0.01 }, label: 'Size', default: () => ({ inputSource: 'literal', value: [0.9, 0.9] }) },
		seed: { dataType: 'number', ui: { control: 'seed' }, label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
		rgb: { dataType: 'bool', ui: { control: 'bool' }, label: 'RGB', default: () => ({ inputSource: 'literal', value: true }) },
		cmy: { dataType: 'bool', ui: { control: 'bool' }, label: 'CMY', default: () => ({ inputSource: 'literal', value: true }) },
		black: { dataType: 'bool', ui: { control: 'bool' }, label: 'Black', default: () => ({ inputSource: 'literal', value: true }) },
		white: { dataType: 'bool', ui: { control: 'bool' }, label: 'White', default: () => ({ inputSource: 'literal', value: true }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
