import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlocks',
	displayName: 'Color blocks',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 100, step: 1 } }, defaultValue: { inputSource: 'literal', value: 50 } },
		alphaRandomness: { dataType: { kind: 'scalar' }, ui: { label: 'Alpha randomness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		size: { dataType: { kind: 'vector' }, ui: { label: 'Size', control: { controlType: 'vector', min: 0.001, max: 1, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		rgb: { dataType: { kind: 'bool' }, ui: { label: 'RGB', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		cmy: { dataType: { kind: 'bool' }, ui: { label: 'CMY', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		black: { dataType: { kind: 'bool' }, ui: { label: 'Black', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		white: { dataType: { kind: 'bool' }, ui: { label: 'White', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
