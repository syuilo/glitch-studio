import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlocks',
	displayName: 'Color blocks',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', min: 0, max: 100, step: 1, label: 'Amount', default: () => ({ inputSource: 'literal', value: 50 }) },
		alphaRandomness: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Alpha randomness', default: () => ({ inputSource: 'literal', value: 1 }) },
		size: { type: 'vector', min: 0, max: 1, step: 0.01, label: 'Size', default: () => ({ inputSource: 'literal', value: [0.9, 0.9] }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
		rgb: { type: 'bool', label: 'RGB', default: () => ({ inputSource: 'literal', value: true }) },
		cmy: { type: 'bool', label: 'CMY', default: () => ({ inputSource: 'literal', value: true }) },
		black: { type: 'bool', label: 'Black', default: () => ({ inputSource: 'literal', value: true }) },
		white: { type: 'bool', label: 'White', default: () => ({ inputSource: 'literal', value: true }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
