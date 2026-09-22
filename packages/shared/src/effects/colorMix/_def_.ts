import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'colorMix',
	displayName: 'Mix (Color)',
	tags: [],
	paramDefs: {
		inputA: { dataType: 'color', ui: { label: 'A', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		inputB: { dataType: 'color', ui: { label: 'B', control: 'color' }, canNode: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
