import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Interpolator (Scalar)',
	summary: {
		'ja-JP': 'Index の位置に応じて、隣り合うスカラー入力を補間します。',
		'en-US': 'Interpolates between adjacent scalar inputs at the specified index.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	thumbnail: { mode: 'none' },
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'scalar' } },
			ui: { label: 'Inputs', control: { element: { controlType: 'number', step: 0.01 } } },
			defaultValue: [0, 0],
			element: { canNode: true, defaultValue: 0 },
		},
		// 候補と入力種別は固定し、補間位置を描画全体で共有する。
		index: { dataType: { kind: 'scalar' }, ui: { label: 'Index', control: { controlType: 'number', min: 0, step: 0.01 } }, defaultValue: 0 },
	},
	// 配列の特定要素を主入力にせず、自動解像度は全入力の静的な計画寸法の最大画素数から求める。
	primaryInputParameter: null,
	resolutionInputParameters: ['inputs'],
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
