import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'transform',
	displayName: 'Transform',
	tags: [],
	primaryInputParameter: 'input',
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		// ±2で画面幅/高さ1つ分の移動。これはUIの操作範囲であり、入力値自体は制限しない。
		translation: { dataType: { kind: 'vector' }, ui: { label: 'Translation', control: { controlType: 'vector', min: -2, max: 2, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0] } },
		scale: { dataType: { kind: 'vector' }, ui: { label: 'Scale', control: { controlType: 'vector', min: -1, max: 4, step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1] } },
		rotation: { dataType: { kind: 'scalar' }, ui: { label: 'Rotation', control: { controlType: 'angle' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	outputDefs: {
		output: { primary: true, dataType: { kind: 'color' } },
	},
});
