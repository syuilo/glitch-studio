import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pointerTrail',
	displayName: 'pointerTrail',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		radius: { dataType: { kind: 'scalar' }, ui: { label: 'Radius', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms)', control: { controlType: 'range', min: 1, max: 5000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'vector' } },
	},
});
