import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelate',
	displayName: 'Pixelate',
	kind: 'modify',
	tags: [],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		density: {
			dataType: { kind: 'vector' },
			ui: { label: 'Density', control: { controlType: 'vector', min: 1, max: 1000, logarithmic: true } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [3, 3] },
		},
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: { kind: 'scalar' }, ui: { label: 'Samples', control: { controlType: 'range', min: 1, max: 256, step: 1 } }, defaultValue: { inputSource: 'literal', value: 16 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
