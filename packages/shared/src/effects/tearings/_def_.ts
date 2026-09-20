import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'tearings',
	displayName: 'Tearings',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'number', ui: { control: 'range', min: 0, max: 100 }, label: 'Amount', default: () => ({ inputSource: 'literal', value: 3 }) },
		strength: { dataType: 'number', ui: { control: 'range', min: -1, max: 1, step: 0.01 }, label: 'Strength', default: () => ({ inputSource: 'literal', value: 0.02 }) },
		size: { dataType: 'number', ui: { control: 'range', min: 0, max: 100, step: 0.01 }, label: 'Size', default: () => ({ inputSource: 'literal', value: 20 }) },
		angle: { dataType: 'number', ui: { control: 'angle' }, label: 'Angle', default: () => ({ inputSource: 'literal', value: 0 }) },
		channelShift: { dataType: 'number', ui: { control: 'range', min: 0, max: 10, step: 0.01 }, label: 'Ch shift', default: () => ({ inputSource: 'literal', value: 0.5 }) },
		seed: { dataType: 'number', ui: { control: 'seed' }, label: 'Seed', default: () => ({ inputSource: 'envVariable', variable: 'TIME' }) },
		wrap: { dataType: 'wrapMode', ui: { control: 'wrapMode' }, label: 'Wrap', default: () => ({ inputSource: 'literal', value: 'repeatMirrored' }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
