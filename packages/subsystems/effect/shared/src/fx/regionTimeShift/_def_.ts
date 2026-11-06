import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'regionTimeShift',
	displayName: 'Region Time Shift',
	description: {
		'ja-JP': 'ブロックや帯、RGBチャンネルごとに映像を遅らせ、異なる時刻が混在する画像を作ります。',
		'en-US': 'Delays blocks, bands, or RGB channels to combine different moments in one image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: true,
	tags: ['glitch', 'temporal', 'pixel', 'color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		layout: {
			dataType: { kind: 'enum', options: ['blocks', 'horizontalBands', 'verticalBands'] },
			ui: { label: 'Regions', control: { labels: { blocks: 'Blocks', horizontalBands: 'Horizontal Bands', verticalBands: 'Vertical Bands' } } },
			defaultValue: { inputSource: 'literal', value: 'blocks' },
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Amount',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		density: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Density',
				control: {
					controlType: 'dimension',
					min: 1,
					max: 100,
					logarithmic: true,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [12, 12] },
		},
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		maxDelay: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Delay (ms)',
				control: {
					controlType: 'range',
					min: 0,
					max: 2000,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 500 },
		},
		channelSplit: { dataType: { kind: 'bool' }, ui: { label: 'Separate RGB Delays', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		patternRate: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Pattern Change Rate (Hz)',
				control: {
					controlType: 'range',
					min: 0,
					max: 30,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		interpolate: { dataType: { kind: 'bool' }, ui: { label: 'Interpolate History Frames', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
		historyFrames: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'History Frames',
				control: {
					controlType: 'range',
					min: 2,
					max: 64,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 8 },
		},
		historyScale: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'History Resolution (%)',
				control: {
					controlType: 'range',
					min: 10,
					max: 100,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 100 },
		},
		seed: { dataType: { kind: 'scalar' }, ui: { label: 'Seed', control: { controlType: 'seed' } }, defaultValue: { inputSource: 'literal', value: 0 } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset History', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
