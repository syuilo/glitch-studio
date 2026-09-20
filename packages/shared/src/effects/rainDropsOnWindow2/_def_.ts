import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow2',
	displayName: 'Rain Drops On Window (Type 2)',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		density: { type: 'range', min: 0, max: 1, step: 0.01, label: 'Density', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		time: { type: 'number', step: 0.01, label: 'Time (s)', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		scale: { type: 'range', min: 0.1, max: 5, step: 0.01, label: 'Scale', default: () => ({ inputSource: 'literal', value: 1 }) },
		refraction: { type: 'range', min: 0, max: 2, step: 0.01, label: 'Refraction', default: () => ({ inputSource: 'literal', value: 0.6 }) },
		seed: { type: 'seed', label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
