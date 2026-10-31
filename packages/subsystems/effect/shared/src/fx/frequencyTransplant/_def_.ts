import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'frequencyTransplant',
	displayName: 'Frequency Transplant',
	description: {
		'ja-JP': '別の画像から指定した周波数帯のDCT係数を移植し、元画像の形と別画像の模様を組み合わせます。',
		'en-US': 'Transplants a selected band of DCT coefficients from another image to combine the original structure with donor textures.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'composite', 'color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		donor: {
			dataType: { kind: 'color' },
			ui: { label: 'Donor', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		blockSize: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Block Size (% of Short Side)',
				control: {
					controlType: 'range',
					min: 1,
					max: 25,
					step: 0.1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 2 },
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
			defaultValue: { inputSource: 'literal', value: 0.2 },
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
			defaultValue: { inputSource: 'literal', value: 1 },
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
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		components: {
			dataType: { kind: 'enum', options: ['all', 'luminance', 'chroma'] },
			ui: { label: 'Components', control: { labels: { all: 'Luminance and Chroma', luminance: 'Luminance Only', chroma: 'Chroma Only' } } },
			defaultValue: { inputSource: 'literal', value: 'all' },
		},
		includeDc: { dataType: { kind: 'bool' }, ui: { label: 'Include DC (Average Color)', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
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
			defaultValue: { inputSource: 'literal', value: 1 },
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
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		preserveDetails: { dataType: { kind: 'bool' }, ui: { label: 'Preserve Input Detail', control: {} }, defaultValue: { inputSource: 'literal', value: true } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
