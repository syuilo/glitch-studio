import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { control: 'color' }, label: 'Input', canNode: true, primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		size: { dataType: 'scalar', ui: { control: 'range', min: 1, max: 200, step: 0.01 }, label: 'Size', default: () => ({ inputSource: 'literal', value: 50 }) },
		border: { dataType: 'scalar', ui: { control: 'range', min: 0, max: 1, step: 0.01 }, label: 'Border', default: () => ({ inputSource: 'literal', value: 0.1 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
