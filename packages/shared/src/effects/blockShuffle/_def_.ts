import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'blockShuffle',
	displayName: 'Block shuffle',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		amount: { dataType: 'scalar', ui: { label: 'Amount', control: 'range', min: 0, max: 1, step: 0.01 }, defaultValue: { inputSource: 'literal', value: 0.5 } },
		// UIの操作範囲は1〜10。式・ノード入力などの値には上限を設けない。
		scale: { dataType: 'vector', ui: { label: 'Scale', control: 'vector', min: 1, max: 10, step: 0.1 }, canNode: true, defaultValue: { inputSource: 'literal', value: [3, 3] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		randomSwap: { dataType: 'bool', ui: { label: 'Random swap', control: 'bool' }, defaultValue: { inputSource: 'literal', value: true } },
		randomRotation: { dataType: 'bool', ui: { label: 'Random rotation', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipX: { dataType: 'bool', ui: { label: 'Random flip X', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		randomFlipY: { dataType: 'bool', ui: { label: 'Random flip Y', control: 'bool' }, defaultValue: { inputSource: 'literal', value: false } },
		seed: { dataType: 'scalar', ui: { label: 'Seed', control: 'seed' }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
