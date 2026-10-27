import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'checker',
	displayName: 'Checker',
	description: {
		'ja-JP': '市松模様を描画します。',
		'en-US': 'Draws a checkerboard pattern.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern'],
	paramDefs: {
		background: {
			dataType: { kind: 'color' },
			ui: { label: 'Background', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		density: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Density',
				control: {
					controlType: 'dimension',
					min: 1,
					max: 1000,
					logarithmic: true,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [3, 3] },
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
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		fitMode: { dataType: { kind: 'fitMode' }, ui: { label: 'Fit Mode', control: {} }, defaultValue: { inputSource: 'literal', value: 'cover' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameter: 'background',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
