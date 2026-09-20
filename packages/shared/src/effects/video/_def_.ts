import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'video',
	displayName: 'Video',
	tags: [],
	paramDefs: {
		player: {
			label: 'Player',
			dataType: 'playerReference', ui: { control: 'player' },
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
