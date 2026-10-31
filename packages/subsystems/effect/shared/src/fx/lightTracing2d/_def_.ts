import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'lightTracing2d',
	displayName: '2D Light Tracing',
	description: {
		'ja-JP': '入力画像の不透明部分を光源・遮蔽物として、2Dの光の広がりと影を描画します。黒背景の不透明な画像を出力します。',
		'en-US': 'Traces 2D light and shadows using opaque input pixels as emitters and occluders. Outputs an opaque image on black.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['light'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		emissionStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Emission Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		absorption: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Absorption', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		alphaThreshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Alpha Threshold', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
		rayCount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Ray Count', control: { controlType: 'range', min: 4, max: 256, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 64 },
		},
		maxSteps: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Max Steps', control: { controlType: 'range', min: 8, max: 512, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 128 },
		},
		resolutionScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Resolution Scale', control: { controlType: 'range', min: 0.25, max: 1, step: 0.05 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
