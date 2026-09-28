import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorBlocks',
	displayName: 'Color blocks',
	tags: [],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 100, step: 1 } }, defaultValue: { inputSource: 'literal', value: 50 } },
		alphaRandomness: { dataType: { kind: 'scalar' }, ui: { label: 'Alpha randomness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		density: { dataType: { kind: 'vector' }, ui: { label: 'Density', control: { controlType: 'vector', min: 1, max: 1000, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: [3, 3] } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		rgb: { dataType: { kind: 'bool' }, ui: { label: 'RGB', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		cmy: { dataType: { kind: 'bool' }, ui: { label: 'CMY', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		black: { dataType: { kind: 'bool' }, ui: { label: 'Black', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		white: { dataType: { kind: 'bool' }, ui: { label: 'White', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
	},
	primaryInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
