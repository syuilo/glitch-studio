import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frameDifference',
	displayName: 'Frame difference',
	description: {
		'ja-JP': '現在の入力と前のフレームの差を取り、変化した部分を抽出します。',
		'en-US': 'Extracts changes by comparing the current input with the previous frame.',
	},
	kind: 'modify',
	tags: ['temporal', 'analysis', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: { dataType: { kind: 'enum', options: ['rgb', 'luminance'] }, ui: { label: 'Mode', control: { labels: { 'rgb': 'RGB', 'luminance': 'Luminance' } } }, defaultValue: { inputSource: 'literal', value: 'rgb' } },
		gain: { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		threshold: { dataType: { kind: 'scalar' }, ui: { label: 'Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
