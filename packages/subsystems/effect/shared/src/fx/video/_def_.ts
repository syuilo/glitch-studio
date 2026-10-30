import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'video',
	displayName: 'Video',
	description: {
		'ja-JP': 'Playerで再生中の映像を出力します。',
		'en-US': 'Outputs the current video frame from a Player.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['media'],
	staticSettingDefs: {
		player: { dataType: { kind: 'playerReference' }, ui: { label: 'Player' }, defaultValue: null },
	},
	intrinsicResolutionSetting: 'player',
	paramDefs: {
		fit: {
			dataType: { kind: 'fitMode' },
			ui: { label: 'Fit', control: {} },
			defaultValue: { inputSource: 'literal', value: 'cover' },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
