import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'chromaticAberration',
	displayName: 'Chromatic Aberration',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
		amount: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Amount', default: () => ({ inputSource: 'literal', value: 0.1 }) },
		rStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'R strength', default: () => ({ inputSource: 'literal', value: 1 }) },
		gStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'G strength', default: () => ({ inputSource: 'literal', value: 1.5 }) },
		bStrength: { type: 'range', min: -10, max: 10, step: 0.01, label: 'B strength', default: () => ({ inputSource: 'literal', value: 2 }) },
		samples: { type: 'number', min: 1, max: 100, label: 'Samples', default: () => ({ inputSource: 'literal', value: 32 }) },
		start: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Start', default: () => ({ inputSource: 'literal', value: 0 }) },
		vector: { type: 'vector', step: 0.01, min: -5, max: 5, label: 'Vector', default: () => ({ inputSource: 'literal', value: [0, 0] }) },
		normalize: { type: 'bool', label: 'Normalize', default: () => ({ inputSource: 'literal', value: false }) },
		wrap: { type: 'wrapMode', label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
