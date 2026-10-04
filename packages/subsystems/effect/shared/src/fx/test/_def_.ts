import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'test',
	displayName: 'test',
	description: {
		'ja-JP': '描画の動作確認用に、座標に応じた色のグラデーションを出力します。',
		'en-US': 'Outputs a coordinate-based color gradient for testing rendering.',
	},
	kind: 'generate',
	tags: ['utility'],
	paramDefs: {
		x: { dataType: { kind: 'scalar' }, ui: { label: 'X', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: { kind: 'scalar' }, ui: { label: 'Y', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
