import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Compose Color',
	summary: {
		'ja-JP': '赤・緑・青とアルファのスカラー入力を組み合わせ、色を作ります。',
		'en-US': 'Combines red, green, blue, and alpha scalar inputs into a color.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['color', 'utility', 'convert'],
	paramDefs: {
		red: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Red', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		green: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Green', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		blue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blue', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		alpha: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Alpha', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
	},
	primaryInputParameter: null,
	// アルファだけがテクスチャの場合もその解像度を使えるよう、各成分を同等に扱う。
	resolutionInputParameters: ['red', 'green', 'blue', 'alpha'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
