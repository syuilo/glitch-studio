import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Video Frame',
	summary: {
		'ja-JP': '動画素材から指定した時刻のフレームを取り出します。',
		'en-US': 'Extracts a frame at the specified time from a video asset.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['media'],
	staticSettingDefs: {
		asset: { dataType: { kind: 'assetReference', assetType: 'video' }, ui: { label: 'Asset' }, defaultValue: null },
	},
	intrinsicResolutionSetting: 'asset',
	paramDefs: {
		time: { dataType: { kind: 'scalar' }, ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } }, defaultValue: 0 },
		fit: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit', control: {} }, defaultValue: 'contain' },
		outOfRange: {
			dataType: { kind: 'enum', options: ['clamp', 'loop', 'transparent'] },
			ui: { label: 'Out of Range', control: { labels: { 'clamp': 'Clamp', 'loop': 'Loop', 'transparent': 'Transparent' } } },
			defaultValue: 'clamp',
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
