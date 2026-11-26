import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Bit Plane Corruption',
	summary: {
		'ja-JP': '色のビットを壊し、デジタルデータの破損のような色の乱れを加えます。',
		'en-US': 'Corrupts color bits to create glitches resembling damaged digital data.',
	},
	kind: 'modify',
	thumbnail: { mode: 'customParameters', params: { density: [14, 14] } },
	dependsOnRenderHistory: false,
	tags: ['color', 'glitch'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		mode: {
			dataType: { kind: 'enum', options: ['invert', 'clear', 'set', 'swap', 'randomize'] },
			ui: {
				label: 'Mode',
				control: {
					labels: {
						invert: 'Invert',
						clear: 'Force 0',
						set: 'Force 1',
						swap: 'Swap First / Last Bit',
						randomize: 'Randomize',
					},
				},
			},
			defaultValue: 'invert',
		},
		bitDepth: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Bit Depth',
				control: {
					controlType: 'range',
					min: 1,
					max: 16,
					step: 1,
				},
			},
			defaultValue: 8,
		},
		firstBit: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'First Bit (0 = LSB)',
				control: {
					controlType: 'range',
					min: 0,
					max: 15,
					step: 1,
				},
			},
			defaultValue: 5,
		},
		lastBit: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Last Bit',
				control: {
					controlType: 'range',
					min: 0,
					max: 15,
					step: 1,
				},
			},
			defaultValue: 7,
		},
		red: { dataType: { kind: 'bool' }, ui: { label: 'Red', control: {} }, defaultValue: true },
		green: { dataType: { kind: 'bool' }, ui: { label: 'Green', control: {} }, defaultValue: true },
		blue: { dataType: { kind: 'bool' }, ui: { label: 'Blue', control: {} }, defaultValue: true },
		sharedErrors: { dataType: { kind: 'bool' }, ui: { label: 'Shared Channel Errors', control: {} }, defaultValue: true },
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
			canNode: true,
			defaultValue: 0.35,
		},
		pattern: {
			dataType: { kind: 'enum', options: ['blocks', 'horizontal', 'vertical', 'wholeImage'] },
			ui: {
				label: 'Corruption Pattern',
				control: {
					labels: {
						blocks: 'Blocks',
						horizontal: 'Horizontal Bands',
						vertical: 'Vertical Bands',
						wholeImage: 'Whole Image',
					},
				},
			},
			defaultValue: 'blocks',
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
			defaultValue: [24, 24],
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: 0 },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
