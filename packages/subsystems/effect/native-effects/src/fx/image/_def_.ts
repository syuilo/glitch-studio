import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Image',
	summary: {
		'ja-JP': '読み込んだ画像素材を出力します。',
		'en-US': 'Outputs an imported image asset.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['media'],
	staticSettingDefs: {
		image: { dataType: { kind: 'assetReference', assetType: 'image' }, ui: { label: 'Image' }, defaultValue: null },
	},
	intrinsicResolutionSetting: 'image',
	paramDefs: {
		fit: {
			dataType: { kind: 'fitMode' },
			ui: { label: 'Fit', control: {} },
			defaultValue: 'cover',
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
