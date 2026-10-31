import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'hexGrid',
	displayName: 'Hex Grid',
	description: {
		'ja-JP': '六角形の格子模様を描画します。',
		'en-US': 'Draws a hexagonal grid pattern.',
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
			// X/Yの周期を別々に数えるため、正六角形となるY周波数はXの1/√3倍。
			defaultValue: { inputSource: 'literal', value: [3, Math.sqrt(3)] },
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
		lineWidth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Line Width',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.036 },
		},
		lineColor: { dataType: { kind: 'color' }, ui: { label: 'Line Color', control: {} }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 0.75] } },
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
	},
	primaryInputParameter: 'background',
	resolutionInputParameters: ['background'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
