import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'image',
	displayName: 'Image',
	description: {
		'ja-JP': '読み込んだ画像素材を出力します。',
		'en-US': 'Outputs an imported image asset.',
	},
	kind: 'generate',
	tags: ['media'],
	paramDefs: {
		image: { dataType: { kind: 'assetReference' }, ui: { label: 'Image', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
		fit: {
			dataType: { kind: 'fitMode' },
			ui: { label: 'Fit', control: {} },
			defaultValue: { inputSource: 'literal', value: 'cover' },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
