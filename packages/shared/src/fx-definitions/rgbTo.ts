import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'rgbTo',
	displayName: 'RGB To',
	paramDefs: {
		input: { type: 'node', label: 'Input', dataType: 'color', primary: true, default: () => ({ type: 'literal', value: null }) },
		mode: {
			label: 'Mode',
			type: 'enum',
			options: [{
				label: 'Intensity',
				value: 0,
			}, {
				label: 'Luminance',
				value: 1,
			}],
			default: () => ({ type: 'literal', value: 0 }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'scalar' },
	},
});
