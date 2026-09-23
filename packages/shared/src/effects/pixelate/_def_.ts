import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelate',
	displayName: 'Pixelate',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		// UIの操作範囲は1〜10。式・ノード入力などの値には上限を設けない。
		scale: { dataType: 'vector', ui: { label: 'Scale', control: 'vector', min: 1, max: 10, step: 0.1 }, canNode: true, defaultValue: { inputSource: 'literal', value: [3, 3] } },
		fitMode: { dataType: 'fitMode', ui: { label: 'Fit mode', control: 'fitMode' }, defaultValue: { inputSource: 'literal', value: 'contain' } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		samples: { dataType: 'scalar', ui: { label: 'Samples', control: 'range', min: 1, max: 256, step: 1 }, defaultValue: { inputSource: 'literal', value: 16 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
