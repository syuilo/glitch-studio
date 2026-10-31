import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'threshold',
	displayName: 'Threshold',
	description: {
		'ja-JP': '入力画像の赤・緑・青それぞれの成分を、個別の閾値以上なら1、未満なら0に二値化します。透明度は維持します。',
		'en-US': 'Binarizes each red, green, and blue channel to 1 at or above its individual threshold, or 0 below it. Preserves alpha.',
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
		rThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold (Red)',
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
		gThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold (Green)',
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
		bThreshold: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Threshold (Blue)',
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
