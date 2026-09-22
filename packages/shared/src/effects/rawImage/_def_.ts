import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rawImage',
	displayName: 'Raw Image',
	tags: [],
	paramDefs: {
		image: {
			dataType: 'assetReference', ui: { label: 'Image', control: 'image' },
			defaultValue: { inputSource: 'literal', value: null },
		},
	},
	outputs: { output: { primary: true, dataType: 'color' } },
});
