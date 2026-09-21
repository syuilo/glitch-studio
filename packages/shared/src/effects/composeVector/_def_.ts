import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVector',
	displayName: 'Compose Vector',
	tags: [],
	paramDefs: {
		x: { dataType: 'scalar', ui: { label: 'X', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: 'scalar', ui: { label: 'Y', control: 'number', step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputs: {
		output: { primary: true, dataType: 'vector' },
	},
});
