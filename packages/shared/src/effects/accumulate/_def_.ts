import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'accumulate',
	displayName: 'Accumulate',
	tags: [],
	paramDefs: {
		input: { dataType: 'any', ui: { control: 'none' }, canNode: true, label: 'Input', primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		strength: { dataType: 'number', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Strength', default: () => ({ inputSource: 'literal', value: 1 }) },
		halfLife: { dataType: 'number', ui: { control: 'range', min: 0, max: 10000, step: 1 }, label: 'Half-life (ms, 0 = infinite)', default: () => ({ inputSource: 'literal', value: 300 }) },
		reset: { dataType: 'bool', ui: { control: 'bool' }, label: 'Reset', default: () => ({ inputSource: 'literal', value: false }) },
	},
	outputs: {
		output: { primary: true, dataType: 'any' },
	},
});
