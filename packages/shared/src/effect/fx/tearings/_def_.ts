import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'tearings',
	displayName: 'Tearings',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		amount: { dataType: { kind: 'scalar' }, ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 100 } }, defaultValue: { inputSource: 'literal', value: 3 } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.02 } },
		size: { dataType: { kind: 'scalar' }, ui: { label: 'Size', control: { controlType: 'range', min: 0, max: 100, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 20 } },
		angle: { dataType: { kind: 'scalar' }, ui: { label: 'Angle', control: { controlType: 'angle' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		channelShift: { dataType: { kind: 'scalar' }, ui: { label: 'Ch shift', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
