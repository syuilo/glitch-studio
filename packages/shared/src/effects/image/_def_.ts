import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'image',
	displayName: 'Image',
	tags: [],
	paramDefs: {
		image: {
			label: 'Image',
			type: 'image',
			default: () => ({ type: 'literal', value: null }),
		},
		sizeMode: {
			label: 'Size mode',
			type: 'enum',
			options: [{
				label: 'Stretch',
				value: 0,
			}, {
				label: 'Cover',
				value: 1,
			}, {
				label: 'Contain',
				value: 2,
			}],
			default: () => ({ type: 'literal', value: 1 as const }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
