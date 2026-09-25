import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'accumulate',
	displayName: 'Accumulate',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: 'any', ui: { label: 'Input', control: 'none' }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'range', min: 0, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		halfLife: { dataType: 'scalar', ui: { label: 'Half-life (ms, 0 = infinite)', control: 'range', min: 0, max: 10000, step: 1 }, defaultValue: { inputSource: 'literal', value: 300 } },
		reset: { dataType: 'bool', ui: { label: 'Reset', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'any' },
	},
});
