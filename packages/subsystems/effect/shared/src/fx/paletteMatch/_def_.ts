import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'paletteMatch',
	displayName: 'Palette Match',
	description: {
		'ja-JP': '主入力の形状と透明度を保ちながら、Oklabの平均色・共分散を副入力へ近づけて配色を移します。',
		'en-US': 'Transfers the reference palette by matching Oklab means and covariances while preserving input geometry and alpha.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		reference: {
			dataType: { kind: 'color' },
			ui: { label: 'Reference', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		lightnessMatch: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Lightness Match', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		chromaMatch: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Chroma Match', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		maximumGain: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Gain', control: { controlType: 'range', min: 1, max: 16, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		analysisSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Analysis Samples', control: { controlType: 'range', min: 1, max: 65536, step: 1, logarithmic: true } },
			defaultValue: { inputSource: 'literal', value: 4096 },
		},
		inputAnalysisMask: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input Analysis Mask', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		referenceAnalysisMask: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Reference Analysis Mask', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
