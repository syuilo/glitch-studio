import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'decoderCorruption',
	displayName: 'Decoder Corruption',
	description: {
		'ja-JP': '周辺ブロックからの予測と残差を意図的に壊し、動画の復号エラーのような色の破綻や模様の引き伸ばしを作ります。描画履歴には依存しません。',
		'en-US': 'Corrupts spatial block prediction and residuals to simulate video decoding errors, with spreading color errors and stretched imagery. Does not depend on render history.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pixel', 'color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Block Size (% of Short Side)', control: { controlType: 'range', min: 1, max: 20, step: 0.1 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		subdivisions: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Subdivision Levels', control: { controlType: 'range', min: 0, max: 2, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 2 },
		},
		splitProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Block Split Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.7 },
		},
		packetWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Resync Width (Maximum Blocks)', control: { controlType: 'range', min: 1, max: 8, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		packetHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Resync Height (Maximum Blocks)', control: { controlType: 'range', min: 1, max: 8, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		predictionMode: {
			dataType: { kind: 'enum', options: ['automatic', 'horizontal', 'vertical', 'dc', 'planar'] },
			ui: {
				label: 'Prediction Mode',
				control: { labels: { automatic: 'Automatic', horizontal: 'Horizontal', vertical: 'Vertical', dc: 'Average Color', planar: 'Planar' } },
			},
			defaultValue: { inputSource: 'literal', value: 'automatic' },
		},
		corruptionProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Corruption Burst Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.12 },
		},
		burstLength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Burst Length (Prediction Blocks)', control: { controlType: 'range', min: 1, max: 64, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 12 },
		},
		predictionError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Prediction Mode Error Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.7 },
		},
		referenceShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Reference Shift (Block Widths)', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		luminanceError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Luminance Error', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		chromaError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Chroma Error', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.45 },
		},
		residualMode: {
			dataType: { kind: 'enum', options: ['mixed', 'drop', 'invert', 'amplify'] },
			ui: { label: 'Residual Corruption Mode', control: { labels: { mixed: 'Mixed', drop: 'Drop', invert: 'Invert', amplify: 'Amplify' } } },
			defaultValue: { inputSource: 'literal', value: 'mixed' },
		},
		residualError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Residual Corruption', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.7 },
		},
		residualNoise: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Residual Noise', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		propagation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Prediction Error Retention', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.95 },
		},
		recoveryProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Block Recovery Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.025 },
		},
		preserveDetails: {
			dataType: { kind: 'bool' },
			ui: { label: 'Preserve Input Detail', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
