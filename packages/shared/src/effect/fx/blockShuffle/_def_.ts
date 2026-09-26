import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size', control: { controlType: 'vector', min: 0.001, max: 1, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] },
		},
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		randomSwap: { dataType: { kind: 'bool' }, ui: { label: 'Random swap', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		randomRotation: { dataType: { kind: 'bool' }, ui: { label: 'Random rotation', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipX: { dataType: { kind: 'bool' }, ui: { label: 'Random flip X', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipY: { dataType: { kind: 'bool' }, ui: { label: 'Random flip Y', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
