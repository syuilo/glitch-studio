import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'accumulate',
	displayName: 'Accumulate',
	kind: 'modify',
	tags: ['temporal', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'any' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms, 0 = infinite)', control: { controlType: 'range', min: 0, max: 10000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
