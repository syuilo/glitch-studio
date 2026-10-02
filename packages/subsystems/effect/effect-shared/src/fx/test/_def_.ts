import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'test',
	displayName: 'test',
	kind: 'generate',
	tags: [],
	paramDefs: {
		x: { dataType: { kind: 'scalar' }, ui: { label: 'X', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: { kind: 'scalar' }, ui: { label: 'Y', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
