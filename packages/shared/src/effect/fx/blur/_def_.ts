import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blur',
	displayName: 'Blur',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		radius: { dataType: 'vector', ui: { label: 'Radius', control: 'vector', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [0.25, 0.25] } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: 'scalar', ui: { label: 'Samples', control: 'range', min: 4, max: 256, step: 1 }, defaultValue: { inputSource: 'literal', value: 32 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
