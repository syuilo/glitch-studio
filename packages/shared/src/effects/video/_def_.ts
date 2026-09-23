import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'video',
	displayName: 'Video',
	tags: [],
	paramDefs: {
		player: {
			dataType: 'playerReference', ui: { label: 'Player', control: 'player' },
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
			}, {
				label: 'Original',
				value: 3,
			}],
			defaultValue: { inputSource: 'literal', value: 1 as const },
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
