import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pointerTrail',
	displayName: 'pointerTrail',
	tags: [],
	paramDefs: {
		strength: { dataType: 'number', ui: { control: 'range', min: 0, max: 2, step: 0.01 }, label: 'Strength', default: { inputSource: 'literal', value: 0.3 }, default: () => ({ inputSource: 'literal', value: 0.3 }) },
		radius: { dataType: 'number', ui: { control: 'range', min: 0, max: 2, step: 0.01 }, label: 'Radius', default: { inputSource: 'literal', value: 0.3 }, default: () => ({ inputSource: 'literal', value: 0.3 }) },
		halfLife: { dataType: 'number', ui: { control: 'range', min: 1, max: 5000, step: 1 }, label: 'Half-life (ms)', default: { inputSource: 'literal', value: 300 }, default: () => ({ inputSource: 'literal', value: 300 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
