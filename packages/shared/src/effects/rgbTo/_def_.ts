import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbTo',
	displayName: 'RGB To',
	tags: [],
	paramDefs: {
		input: { type: 'color', label: 'Input', canNode: true, primary: true, default: () => ({ type: 'node', nodeId: null, outputPort: null }) },
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
