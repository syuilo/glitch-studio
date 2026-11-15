import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelateTransition',
	displayName: 'Pixelate Transition',
	description: {
		'ja-JP': '画像Aを粗いモザイクに変え、画像Bへ切り替えてから細部を戻します。',
		'en-US': 'Pixelates image A, transitions to image B, then restores fine detail.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'pixel'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		maximumCellSize: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Maximum Cell Size (Reference Ratio)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		peakPosition: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Peak Position', control: { controlType: 'range', min: 0.001, max: 0.999, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		mixWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Mix Width (Progress)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		gridOffset: {
			dataType: { kind: 'vector' },
			ui: { label: 'Grid Offset', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		samples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Samples', isAdvanced: true, control: { controlType: 'range', min: 1, max: 64, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 16 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
