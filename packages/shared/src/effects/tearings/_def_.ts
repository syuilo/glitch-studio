import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'tearings',
	displayName: 'Tearings',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', min: 0, max: 100, label: 'Amount', default: () => ({ inputSource: 'literal', value: 3 }) },
		strength: { type: 'range', min: -1, max: 1, step: 0.01, label: 'Strength', default: () => ({ inputSource: 'literal', value: 0.02 }) },
		size: { type: 'range', min: 0, max: 100, step: 0.01, label: 'Size', default: () => ({ inputSource: 'literal', value: 20 }) },
		angle: { type: 'angle', label: 'Angle', default: () => ({ inputSource: 'literal', value: 0 }) },
		channelShift: { type: 'range', min: 0, max: 10, step: 0.01, label: 'Ch shift', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
