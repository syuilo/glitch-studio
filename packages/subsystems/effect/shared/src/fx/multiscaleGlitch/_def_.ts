import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiscaleGlitch',
	displayName: 'Multiscale Glitch',
	description: {
		'ja-JP': '画像を細部・中間の模様・大きな形に分解し、それぞれを独立してずらしたり変色させたりします。元画像の透明度と、加工していない部分の細部を保持します。',
		'en-US': 'Separates an image into fine detail, medium structures, and coarse shapes, then independently displaces and corrupts their colors. Preserves input alpha and unaffected detail.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'distortion', 'color', 'stylized', 'experimental'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		probability: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Corruption Probability',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.4 },
		},
		fineScale: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Fine Scale (% of Reference)',
				control: {
					controlType: 'range',
					min: 0.1,
					max: 5,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		coarseScale: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Coarse Scale (% of Reference)',
				control: {
					controlType: 'range',
					min: 1,
					max: 25,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 8 },
		},
		blockShape: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Block Shape',
				control: {
					controlType: 'dimension',
					min: 0.1,
					max: 8,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: [4, 1] },
		},
		fineEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Fine Detail Corruption', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		fineAmount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Fine Detail Amount',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		fineShift: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Fine Detail Displacement (Blocks)',
				control: {
					controlType: 'vector',
					min: 0,
					max: 3,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [1, 0.15] },
		},
		mediumEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Medium Structure Corruption', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		mediumAmount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Medium Structure Amount',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		mediumShift: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Medium Structure Displacement (Blocks)',
				control: {
					controlType: 'vector',
					min: 0,
					max: 3,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0.6, 0.2] },
		},
		coarseEnabled: { dataType: { kind: 'bool' }, ui: { label: 'Coarse Shape Corruption', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
		coarseAmount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Coarse Shape Amount',
				control: {
					controlType: 'range',
					min: 0,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		coarseShift: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Coarse Shape Displacement (Blocks)',
				control: {
					controlType: 'vector',
					min: 0,
					max: 3,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0.35, 0.15] },
		},
		colorCorruption: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Color Corruption',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
