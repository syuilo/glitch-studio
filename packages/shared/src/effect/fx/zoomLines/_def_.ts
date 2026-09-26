import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'zoomLines',
	displayName: 'Zoom lines',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		position: { dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		frequency: { dataType: { kind: 'scalar' }, ui: { label: 'Frequency', control: { controlType: 'range', min: 0, max: 15, step: 0.1 } }, defaultValue: { inputSource: 'literal', value: 5 } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Density', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		outlineThickness: { dataType: { kind: 'scalar' }, ui: { label: 'Outline thickness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.25 } },
		maskSize: { dataType: { kind: 'scalar' }, ui: { label: 'Mask size', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
