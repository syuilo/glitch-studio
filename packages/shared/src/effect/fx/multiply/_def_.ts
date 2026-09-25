import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiply',
	displayName: 'multiply',
	tags: [],
	paramDefs: {
		input: { dataType: 'scalar', ui: { label: 'Input', control: 'number' }, canNode: true, primary: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		v: { dataType: 'scalar', ui: { label: 'Value', control: 'range', min: -10, max: 10, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 2 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
