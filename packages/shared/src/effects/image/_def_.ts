import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'image',
	displayName: 'Image',
	tags: [],
	paramDefs: {
		image: {
			label: 'Image',
			dataType: 'assetReference', ui: { control: 'image' },
			default: () => ({ inputSource: 'literal', value: null }),
		},
		sizeMode: {
			label: 'Size mode',
			dataType: 'enum', ui: { control: 'enum' },
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
			default: () => ({ inputSource: 'literal', value: 1 as const }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
