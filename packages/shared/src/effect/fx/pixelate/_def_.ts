import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelate',
	displayName: 'Pixelate',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size', control: { controlType: 'vector', min: 0.001, max: 1, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1 / 3, 1 / 3] },
		},
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'range', min: 1, max: 256, step: 1 } }, defaultValue: { inputSource: 'literal', value: 16 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
