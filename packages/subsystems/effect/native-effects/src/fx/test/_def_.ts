import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Test',
	summary: {
		'ja-JP': '描画の動作確認用に、座標に応じた色のグラデーションを出力します。',
		'en-US': 'Outputs a coordinate-based color gradient for testing rendering.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['utility'],
	paramDefs: {
		x: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'X',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0,
		},
		y: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Y',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
