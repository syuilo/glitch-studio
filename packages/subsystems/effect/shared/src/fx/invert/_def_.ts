import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'invert',
	displayName: 'Invert',
	description: {
		'ja-JP': '入力画像の赤・緑・青のうち、選択した成分を反転します。',
		'en-US': 'Inverts the selected red, green, and blue channels of the input image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		red: { dataType: { kind: 'bool' }, ui: { label: 'Red', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		green: { dataType: { kind: 'bool' }, ui: { label: 'Green', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		blue: { dataType: { kind: 'bool' }, ui: { label: 'Blue', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
