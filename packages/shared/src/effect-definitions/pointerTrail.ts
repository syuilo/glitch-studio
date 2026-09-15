import { defineEffect } from '../effect-definition.ts';

export default defineEffect({
	id: 'pointerTrail',
	displayName: 'pointerTrail',
	tags: [],
	paramDefs: {
		strength: { type: 'range', min: 0, max: 2, step: 0.01, label: 'Strength', default: { type: 'literal', value: 0.3 }, default: () => ({ type: 'literal', value: 0.3 }) },
		radius: { type: 'range', min: 0, max: 2, step: 0.01, label: 'Radius', default: { type: 'literal', value: 0.3 }, default: () => ({ type: 'literal', value: 0.3 }) },
		halfLife: { type: 'range', min: 1, max: 5000, step: 1, label: 'Half-life (ms)', default: { type: 'literal', value: 300 }, default: () => ({ type: 'literal', value: 300 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
