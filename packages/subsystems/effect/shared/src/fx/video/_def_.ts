import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'video',
	displayName: 'Video',
	description: {
		'ja-JP': 'Playerで再生中の映像を出力します。',
		'en-US': 'Outputs the current video frame from a Player.',
	},
	kind: 'generate',
	tags: ['media'],
	paramDefs: {
		player: { dataType: { kind: 'playerReference' }, ui: { label: 'Player', control: {} }, defaultValue: { inputSource: 'literal', value: null } },
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
