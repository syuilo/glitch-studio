import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'polkadot',
	displayName: 'Polka Dot',
	description: {
		'ja-JP': '水玉模様を描画します。',
		'en-US': 'Draws a polka dot pattern.',
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
		majorRadius: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Major Radius',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		majorColor: { dataType: { kind: 'color' }, ui: { label: 'Major Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		minorDivisions: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Minor Divisions',
				control: {
					controlType: 'range',
					min: 0,
					max: 16,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		minorRadius: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Minor Radius',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		minorColor: { dataType: { kind: 'color' }, ui: { label: 'Minor Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.5] } },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameters: ['background'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
