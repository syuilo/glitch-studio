import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'image',
	displayName: 'Image',
	tags: [],
	paramDefs: {
		image: {
			dataType: 'assetReference', ui: { label: 'Image', control: 'image' },
			defaultValue: { inputSource: 'literal', value: null },
		},
		sizeMode: {
			dataType: 'enum', ui: { label: 'Size mode', control: 'enum' },
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
			defaultValue: { inputSource: 'literal', value: 1 as const },
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
