import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		size: { dataType: 'scalar', ui: { label: 'Size', control: 'range', min: 1, max: 200, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 50 } },
		border: { dataType: 'scalar', ui: { label: 'Border', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.1 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
