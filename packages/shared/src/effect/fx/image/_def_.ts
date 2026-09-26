import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'image',
	displayName: 'Image',
	tags: [],
	primaryInputParameter: null,
	paramDefs: {
		image: { dataType: { kind: 'assetReference' }, ui: { label: 'Image', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		sizeMode: {
			dataType: { kind: 'enum', options: ['stretch', 'cover', 'contain', 'original'] },
			ui: { label: 'Size mode', control: { labels: { 'stretch': 'Stretch', 'cover': 'Cover', 'contain': 'Contain', 'original': 'Original' } } },
			defaultValue: { inputSource: 'literal', value: 'cover' },
		},
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
