import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Checker',
	summary: {
		'ja-JP': '市松模様を描画します。',
		'en-US': 'Draws a checkerboard pattern.',
	},
	kind: 'generate',
	thumbnail: {
		mode: 'customParameters',
		inputs: {},
		params: { background: [0.012, 0.025, 0.065, 1], color: [0.12, 0.66, 0.86, 1] },
	},
	dependsOnRenderHistory: false,
	tags: ['pattern'],
	paramDefs: {
		background: {
			dataType: { kind: 'color' },
			ui: { label: 'Background', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		frequency: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Frequency',
				control: {
					controlType: 'dimension',
					min: 0.01,
					max: 1000,
					logarithmic: true,
				},
			},
			canNode: true,
			defaultValue: [3, 3],
		},
		// Phaseは画面上の距離ではなく、回転後のパターンの1周期を単位にする。
		phase: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Phase',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: [0, 0],
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: 0,
		},
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: [1, 1, 1, 0.5] },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
	},
	primaryInputParameter: 'background',
	resolutionInputParameters: ['background'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
