import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'contrast',
	displayName: 'Contrast',
	description: {
		'ja-JP': 'sRGB値の基準値を中心にコントラストを調整します。HDR・負値を保持します。',
		'en-US': 'Adjusts contrast around an sRGB pivot while preserving HDR and negative values.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		contrast: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Contrast',
				control: {
					controlType: 'range',
					min: 0,
					max: 4,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		pivot: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Pivot (sRGB)',
				control: {
					controlType: 'range',
					min: 0,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
