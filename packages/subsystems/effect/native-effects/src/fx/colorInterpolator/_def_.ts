import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Interpolator (Color)',
	summary: {
		'ja-JP': 'Index の位置に応じて、隣り合う画像や色を補間します。',
		'en-US': 'Interpolates between adjacent image or color inputs at the specified index.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'composite', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: [0, 0, 0, 1] } },
					{ id: 'second', binding: { inputSource: 'literal', value: [0, 0, 0, 1] } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 1] } },
		},
		// 候補と入力種別は固定し、補間位置を描画全体で共有する。
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	// 配列の特定要素を主入力にせず、自動解像度は全入力の静的な計画寸法の最大画素数から求める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
