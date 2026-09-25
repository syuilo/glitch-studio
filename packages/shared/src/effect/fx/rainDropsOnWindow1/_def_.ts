import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow1',
	displayName: 'Rain Drops On Window (Type 1)',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		density: { dataType: 'scalar', ui: { label: 'Density', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		refraction: { dataType: 'scalar', ui: { label: 'Refraction', control: 'range', min: 0, max: 2, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		fog: { dataType: 'scalar', ui: { label: 'Fog', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.35 } },
		time: { dataType: 'scalar', ui: { label: 'Time (s)', control: 'number', step: 0.01 }, defaultValue: { inputSource: 'envVariable', variable: 'TIME' } },
		scale: { dataType: 'scalar', ui: { label: 'Scale', control: 'range', min: 0.1, max: 5, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 1 } },
		seed: { dataType: 'scalar', ui: { label: 'Seed', control: 'seed' }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'color' },
	},
});
