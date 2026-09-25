import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'test',
	displayName: 'test',
	tags: [],
	paramDefs: {
		x: { dataType: 'scalar', ui: { label: 'X', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: 'scalar', ui: { label: 'Y', control: 'range', min: -1, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
