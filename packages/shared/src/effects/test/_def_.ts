import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'test',
	displayName: 'test',
	tags: [],
	paramDefs: {
		x: { type: 'range', min: -1, max: 1, step: 0.01, label: 'X', default: () => ({ inputSource: 'literal', value: 0 }) },
		y: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Y', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
