import { defineEffect } from '../fx-definition.ts';

export default defineEffect({
	name: 'video',
	displayName: 'Video',
	tags: [],
	paramDefs: {
		player: {
			label: 'Player',
			type: 'player',
			default: () => ({ type: 'literal', value: null }),
		},
		sizeMode: {
			label: 'Size mode',
			type: 'enum',
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
			default: () => ({ type: 'literal', value: 1 }),
		},
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
