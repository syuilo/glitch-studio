import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { maximumSubdivisionLevels } from './partition.ts';

export default defineNativeEffect({
	displayName: 'Decoder Corruption',
	summary: {
		'ja-JP': '動画の復号エラーのような色の破綻や模様の引き伸ばしを加えます。',
		'en-US': 'Creates spreading color errors and stretched imagery resembling video decoding errors.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch'],
	thumbnail: { mode: 'defaultParameters' },
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Block Size (% of Reference)', control: { controlType: 'range', min: 2, max: 20, step: 0.1 } },
			defaultValue: 4,
		},
		blockOrigin: {
			dataType: { kind: 'enum', options: ['topLeft', 'center'] },
			ui: { label: 'Block Origin', control: { labels: { topLeft: 'Top Left', center: 'Center' } } },
			defaultValue: 'center',
		},
		subdivisions: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Subdivision Levels', control: { controlType: 'range', min: 0, max: maximumSubdivisionLevels, step: 1 } },
			defaultValue: 4,
		},
		splitProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Block Split Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.7,
		},
		packetWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Resync Width (Maximum Blocks)', control: { controlType: 'range', min: 1, max: 32, step: 1 } },
			defaultValue: 8,
		},
		packetHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Resync Height (Maximum Blocks)', control: { controlType: 'range', min: 1, max: 32, step: 1 } },
			defaultValue: 8,
		},
		predictionMode: {
			dataType: { kind: 'enum', options: ['automatic', 'horizontal', 'vertical', 'dc', 'planar'] },
			ui: {
				label: 'Prediction Mode',
				control: { labels: { automatic: 'Automatic', horizontal: 'Horizontal', vertical: 'Vertical', dc: 'Average Color', planar: 'Planar' } },
			},
			defaultValue: 'automatic',
		},
		corruptionProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Corruption Burst Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.12,
		},
		burstLength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Burst Length (Prediction Blocks)', control: { controlType: 'range', min: 1, max: 64, step: 1 } },
			defaultValue: 12,
		},
		predictionError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Prediction Mode Error Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.7,
		},
		referenceShift: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Reference Shift (Block Widths)', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
			defaultValue: 0.5,
		},
		luminanceError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Luminance Error', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.1,
		},
		chromaError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Chroma Error', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.45,
		},
		residualMode: {
			dataType: { kind: 'enum', options: ['mixed', 'drop', 'invert', 'amplify'] },
			ui: { label: 'Residual Corruption Mode', control: { labels: { mixed: 'Mixed', drop: 'Drop', invert: 'Invert', amplify: 'Amplify' } } },
			defaultValue: 'mixed',
		},
		residualError: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Residual Corruption', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.7,
		},
		residualNoise: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Residual Noise', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.08,
		},
		propagation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Prediction Error Retention', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.95,
		},
		recoveryProbability: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Block Recovery Probability', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.025,
		},
		preserveDetails: {
			dataType: { kind: 'bool' },
			ui: { label: 'Preserve Input Detail', control: {} },
			defaultValue: true,
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
