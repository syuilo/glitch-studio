import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Adaptive Block Glitch',
	summary: {
		'ja-JP': '入力の色・透明度の変化に応じて大小のブロックに分割し、位置ずれや色の破損を加えます。',
		'en-US': 'Divides the input into blocks sized according to color and opacity variation, then applies displacement and color corruption.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'color', 'stylized'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		maxBlockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Block Size (% of Reference)',
				control: {
					controlType: 'range',
					min: 5,
					max: 100,
					step: 1,
				},
			},
			defaultValue: 25,
		},
		subdivisions: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Subdivision Levels',
				control: {
					controlType: 'range',
					min: 0,
					max: 8,
					step: 1,
				},
			},
			defaultValue: 5,
		},
		threshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Detail Threshold',
				control: {
					controlType: 'range',
					min: 0,
					max: 0.3,
					step: 0.001,
				},
			},
			defaultValue: 0.06,
		},
		analysisSamples: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Analysis Samples per Axis',
				control: {
					controlType: 'range',
					min: 1,
					max: 8,
					step: 1,
				},
			},
			defaultValue: 4,
		},
		amount: {
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
			defaultValue: 0.6,
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		displacement: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Displacement (Block Widths)',
				control: {
					controlType: 'range',
					min: 0,
					max: 4,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		snapToBlocks: { dataType: { kind: 'bool' }, ui: { label: 'Snap Displacement to Blocks', control: {} }, defaultValue: false },
		colorShift: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Color Error',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.2,
		},
		channelShift: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Channel Displacement (Block Widths)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.1,
		},
		flattenBlocks: { dataType: { kind: 'bool' }, ui: { label: 'Flatten Blocks', control: {} }, defaultValue: false },
		preserveAlpha: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Alpha', control: {} }, defaultValue: true },
		outline: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Outline Width',
				control: {
					controlType: 'range',
					min: 0,
					max: 0.1,
					step: 0.001,
				},
			},
			defaultValue: 0,
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
