import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'remap',
	displayName: 'Remap',
	tags: [],
	paramDefs: {
		input: { dataType: 'scalar', ui: { control: 'number' }, canNode: true, label: 'Input', primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		inMin: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'In Min', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		inMax: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'In Max', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
		outMin: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Out Min', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		outMax: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Out Max', canNode: true, default: () => ({ inputSource: 'literal', value: 1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
