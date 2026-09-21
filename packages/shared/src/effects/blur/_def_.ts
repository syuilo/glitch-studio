import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blur',
	displayName: 'Blur',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.25 } },
		samples: { dataType: 'scalar', ui: { label: 'Samples', control: 'range', min: 4, max: 256, step: 1 }, defaultValue: { inputSource: 'literal', value: 16 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
