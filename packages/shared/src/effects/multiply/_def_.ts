import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiply',
	displayName: 'multiply',
	tags: [],
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'scalar', primary: true, default: () => ({ inputSource: 'literal', value: null }) },
		v: { type: 'range', min: -10, max: 10, step: 0.01, label: 'Value', default: () => ({ inputSource: 'literal', value: 2 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
