import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Selector (Scalar)',
	summary: {
		'ja-JP': '複数のスカラー入力を切り替えたり、なめらかに混ぜ合わせたりします。',
		'en-US': 'Switches or smoothly blends between multiple scalar inputs.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'scalar' } },
			ui: { label: 'Inputs', control: { element: { controlType: 'number', step: 0.01 } } },
			defaultValue: {
				inputSource: 'literal',
				value: [
					{ id: 'first', binding: { inputSource: 'literal', value: 0 } },
					{ id: 'second', binding: { inputSource: 'literal', value: 0 } },
				],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		},
		// 候補と入力種別は固定し、選択位置だけを描画全体で共有する。
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	// 配列の特定要素を主入力にせず、自動解像度は全入力の静的な計画寸法の最大画素数から求める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
