import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blur',
	displayName: 'Blur',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		amount: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Amount', canNode: true, default: () => ({ inputSource: 'literal', value: 0.25 }) },
		samples: { dataType: 'scalar', ui: { control: 'range', min: 4, max: 256, step: 1 }, label: 'Samples', default: () => ({ inputSource: 'literal', value: 16 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
