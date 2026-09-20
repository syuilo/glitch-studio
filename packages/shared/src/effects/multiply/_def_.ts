import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiply',
	displayName: 'multiply',
	tags: [],
	paramDefs: {
		input: { dataType: 'scalar', ui: { control: 'number' }, canNode: true, label: 'Input', primary: true, default: () => ({ inputSource: 'node', nodeId: null, outputPort: null }) },
		v: { dataType: 'scalar', ui: { control: 'range', min: -10, max: 10, step: 0.01 }, label: 'Value', default: () => ({ inputSource: 'literal', value: 2 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
