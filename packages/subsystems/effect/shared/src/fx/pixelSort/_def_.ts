import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'pixelSort',
	displayName: 'Pixel Sort',
	description: {
		'ja-JP': '指定した輝度範囲内の画素を並べ替え、色が流れるような模様を作ります。',
		'en-US': 'Sorts pixels within a luminance range to create streaks of color.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['glitch', 'pixel', 'stylized', 'experimental'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		thresholdMin: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold Min',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		thresholdMax: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold Max',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.001,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		direction: {
			dataType: { kind: 'enum', options: ['horizontal', 'vertical'] },
			ui: { label: 'Direction', control: { labels: { 'horizontal': 'Horizontal', 'vertical': 'Vertical' } } },
			defaultValue: { inputSource: 'literal', value: 'horizontal' },
		},
		order: {
			dataType: { kind: 'enum', options: ['descending', 'ascending'] },
			ui: { label: 'Order', control: { labels: { 'descending': 'A > B', 'ascending': 'B > A' } } },
			defaultValue: { inputSource: 'literal', value: 'descending' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
