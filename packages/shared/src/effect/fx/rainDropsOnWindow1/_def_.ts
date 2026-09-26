import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rainDropsOnWindow1',
	displayName: 'Rain Drops On Window (Type 1)',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Density', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.6 } },
		refraction: { dataType: { kind: 'scalar' }, ui: { label: 'Refraction', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.8 } },
		fog: { dataType: { kind: 'scalar' }, ui: { label: 'Fog', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.35 } },
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		scale: { dataType: { kind: 'scalar' }, ui: { label: 'Scale', control: { controlType: 'range', min: 0.1, max: 5, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
