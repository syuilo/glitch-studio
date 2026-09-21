import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pointerTrail',
	displayName: 'pointerTrail',
	tags: [],
	paramDefs: {
		strength: { dataType: 'scalar', ui: { label: 'Strength', control: 'range', min: 0, max: 2, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		radius: { dataType: 'scalar', ui: { label: 'Radius', control: 'range', min: 0, max: 2, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.3 } },
		halfLife: { dataType: 'scalar', ui: { label: 'Half-life (ms)', control: 'range', min: 1, max: 5000, step: 1 }, defaultValue: { inputSource: 'literal', value: 300 } },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
