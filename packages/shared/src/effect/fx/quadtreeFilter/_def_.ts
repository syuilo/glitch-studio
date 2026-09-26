import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'quadtreeFilter',
	displayName: 'Quadtree filter',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Thresold', control: { controlType: 'range', min: 0, max: 0.15, step: 0.00001 } }, defaultValue: { inputSource: 'literal', value: 0.005 } },
		minDivisions: { dataType: { kind: 'scalar' }, ui: { label: 'Min divisions', control: { controlType: 'range', min: 1, max: 64, step: 1 } }, defaultValue: { inputSource: 'literal', value: 4 } },
		maxIterations: { dataType: { kind: 'scalar' }, ui: { label: 'Max iterations', control: { controlType: 'range', min: 1, max: 16, step: 1 } }, defaultValue: { inputSource: 'literal', value: 10 } },
		borderWidth: { dataType: { kind: 'scalar' }, ui: { label: 'Border width', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		borderAbsolute: { dataType: { kind: 'bool' }, ui: { label: 'Border absolute', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
