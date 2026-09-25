import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlocks',
	displayName: 'Color blocks',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 100, step: 1 }, defaultValue: { inputSource: 'literal', value: 50 } },
		alphaRandomness: { dataType: 'scalar', ui: { label: 'Alpha randomness', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		size: { dataType: 'vector', ui: { label: 'Size', control: 'vector', min: 0, max: 1, step: 0.001 }, defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] } },
		seed: { dataType: 'scalar', ui: { label: 'Seed', control: 'seed' }, defaultValue: { inputSource: 'literal', value: 0 } },
		rgb: { dataType: 'bool', ui: { label: 'RGB', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		cmy: { dataType: 'bool', ui: { label: 'CMY', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		black: { dataType: 'bool', ui: { label: 'Black', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		white: { dataType: 'bool', ui: { label: 'White', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
