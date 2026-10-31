import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'stripe',
	displayName: 'Stripe',
	description: {
		'ja-JP': '縞模様を描画します。',
		'en-US': 'Draws a striped pattern.',
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
		// 基準領域あたりの周期数。初期値は角周波数100に相当する。
		frequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Frequency',
				control: {
					controlType: 'range',
					min: 0.01,
					max: 1000,
					logarithmic: true,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 100 / (2 * Math.PI) },
		},
		// Phaseは画面上の距離ではなく、回転後のパターンの1周期を単位にする。
		phase: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Phase',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Width',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		color: { dataType: { kind: 'color' }, ui: { label: 'Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameters: ['background'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
