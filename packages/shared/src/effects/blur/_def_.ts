import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blur',
	displayName: 'Blur',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', label: 'Amount', min: 0, max: 1, step: 0.01, canNode: true, default: () => ({ inputSource: 'literal', value: 0.25 }) },
		samples: { type: 'range', label: 'Samples', min: 4, max: 256, step: 1, default: () => ({ inputSource: 'literal', value: 16 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
