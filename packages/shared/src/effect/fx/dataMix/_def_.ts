import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'dataMix',
	displayName: 'Mix (Data)',
	tags: [],
	paramDefs: {
		inputA: { dataType: 'any', ui: { label: 'A', control: 'none' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		inputB: { dataType: 'any', ui: { label: 'B', control: 'none' }, canNode: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0.5 } },
	},
	outputDefs: {
		output: { primary: true, dataType: 'any' },
	},
});
