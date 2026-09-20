import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow1',
	displayName: 'Rain Drops On Window (Type 1)',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		density: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Density', default: () => ({ inputSource: 'literal', value: 0.6 }) },
		refraction: { dataType: 'number', ui: { control: 'range', min: 0, max: 2, step: 0.01 }, label: 'Refraction', default: () => ({ inputSource: 'literal', value: 0.8 }) },
		fog: { dataType: 'number', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Fog', default: () => ({ inputSource: 'literal', value: 0.35 }) },
		time: { dataType: 'number', ui: { control: 'number', step: 0.01 }, label: 'Time (s)', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		scale: { dataType: 'number', ui: { control: 'range', min: 0.1, max: 5, step: 0.01 }, label: 'Scale', default: () => ({ inputSource: 'literal', value: 1 }) },
		seed: { dataType: 'number', ui: { control: 'seed' }, label: 'Seed', default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
