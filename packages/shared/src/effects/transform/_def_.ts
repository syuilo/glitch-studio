import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'transform',
	displayName: 'Transform',
	tags: [],
	paramDefs: {
		input: { dataType: 'color', ui: { label: 'Input', control: 'color' }, canNode: true, primary: true, defaultValue: { inputSource: 'node', nodeId: null, outputPort: null } },
		// ±2で画面幅/高さ1つ分の移動。これはUIの操作範囲であり、入力値自体は制限しない。
		translation: { dataType: 'vector', ui: { label: 'Translation', control: 'vector', min: -2, max: 2, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		scale: { dataType: 'vector', ui: { label: 'Scale', control: 'vector', min: -1, max: 4, step: 0.01 }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		rotation: { dataType: 'scalar', ui: { label: 'Rotation', control: 'angle' }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputs: {
		output: { primary: true, dataType: 'color' },
	},
});
