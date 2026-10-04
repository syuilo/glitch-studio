import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lcd',
	displayName: 'LCD',
	description: {
		'ja-JP': '入力画像を液晶ディスプレイのRGBサブピクセル風に表現します。',
		'en-US': 'Renders the input image as RGB subpixels like an LCD screen.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['pixel', 'pattern', 'gimmicky', 'stylized'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		density: { dataType: { kind: 'scalar' }, ui: { label: 'Density', control: { controlType: 'range', min: 1, max: 1000, logarithmic: true } }, defaultValue: { inputSource: 'literal', value: 200 } },
		border: { dataType: { kind: 'scalar' }, ui: { label: 'Border', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0.1 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
