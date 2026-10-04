import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	description: {
		'ja-JP': '入力画像をブロックごとにランダムにずらします。',
		'en-US': 'Randomly shifts blocks of the input image.',
	},
	kind: 'modify',
	tags: ['glitch', 'pixel', 'gimmicky', 'experimental'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		density: {
			dataType: { kind: 'vector' },
			ui: { label: 'Density', control: { controlType: 'vector', min: 1, max: 1000, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0.1, 0.1] },
		},
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		randomSwap: { dataType: { kind: 'bool' }, ui: { label: 'Random swap', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		randomRotation: { dataType: { kind: 'bool' }, ui: { label: 'Random rotation', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipX: { dataType: { kind: 'bool' }, ui: { label: 'Random flip X', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipY: { dataType: { kind: 'bool' }, ui: { label: 'Random flip Y', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
