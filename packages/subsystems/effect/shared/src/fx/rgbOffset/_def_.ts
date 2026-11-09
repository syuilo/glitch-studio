import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'rgbOffset',
	displayName: 'RGB Offset',
	description: {
		'ja-JP': 'sRGBのRGB各成分へ同じ値を加算します。HDR・負値を保持します。',
		'en-US': 'Adds the same offset to each sRGB channel while preserving HDR and negative values.',
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
		offset: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Offset (sRGB)',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
