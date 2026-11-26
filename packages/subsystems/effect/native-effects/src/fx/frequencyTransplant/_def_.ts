import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Frequency Transplant',
	summary: {
		'ja-JP': '別の画像の模様や細部を取り込み、元画像の形と組み合わせます。',
		'en-US': 'Combines the original image structure with textures or details from another image.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'composite'],
	thumbnail: {
		mode: 'customParameters',
		inputs: { input: 'sceneA', donor: 'sceneB' },
		params: { blockSize: 6, minFrequency: 0.1, donorGain: 1.6 },
	},
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: 'longSide' },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		donor: {
			dataType: { kind: 'color' },
			ui: { label: 'Donor', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Reference)',
				control: {
					controlType: 'range',
					min: 1,
					max: 25,
					step: 0.1,
				},
			},
			defaultValue: 2,
		},
		minFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Minimum Frequency',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.2,
		},
		maxFrequency: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Maximum Frequency',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		softness: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Frequency Boundary Softness',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: 0.05,
		},
		components: {
			dataType: { kind: 'enum', options: ['all', 'luminance', 'chroma'] },
			ui: { label: 'Components', control: { labels: { all: 'Luminance and Chroma', luminance: 'Luminance Only', chroma: 'Chroma Only' } } },
			defaultValue: 'all',
		},
		includeDc: { dataType: { kind: 'bool' }, ui: { label: 'Include DC (Average Color)', control: {} }, defaultValue: false },
		donorGain: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Donor Gain',
				control: {
					controlType: 'range',
					min: 0,
					max: 4,
					step: 0.01,
				},
			},
			defaultValue: 1,
		},
		donorOffset: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Donor Offset',
				control: {
					controlType: 'xy',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: [0, 0],
		},
		preserveDetails: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Input Detail', control: {} }, defaultValue: true },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
