import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Switch (Color)',
	summary: {
		'ja-JP': '条件の真偽で二つの画像や色を切り替えます。',
		'en-US': 'Switches between two images or colors based on a boolean condition.',
	},
	kind: 'modify',
	thumbnail: { mode: 'none' },
	dependsOnRenderHistory: false,
	tags: ['color', 'composite', 'utility'],
	paramDefs: {
		condition: {
			dataType: { kind: 'bool' },
			ui: { label: 'Condition', control: {} },
			defaultValue: false,
		},
		falseInput: {
			dataType: { kind: 'color' },
			ui: { label: 'False', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		trueInput: {
			dataType: { kind: 'color' },
			ui: { label: 'True', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
	},
	primaryInputParameter: null,
	// Conditionが変わっても下流の描画サイズを保つため、両入力の計画寸法を使う。
	resolutionInputParameters: ['falseInput', 'trueInput'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
