import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'drosteRegression',
	displayName: 'Droste Regression',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', min: 0, max: 32, step: 0.01, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		twist: { type: 'range', min: 0.04, max: 8, step: 0.001, label: 'Twist', default: () => ({ inputSource: 'literal', value: 2 }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
