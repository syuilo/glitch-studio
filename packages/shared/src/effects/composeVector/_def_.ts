import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVector',
	displayName: 'Compose Vector',
	tags: [],
	paramDefs: {
		x: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'X', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
		y: { dataType: 'scalar', ui: { control: 'number', step: 0.01 }, label: 'Y', canNode: true, default: () => ({ inputSource: 'literal', value: 0 }) },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
