import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Soft Clamp',
	summary: {
		'ja-JP': '明度を指定した上下限に収めます。下限・上限それぞれの境界をなだらかにし、対象外の中間調と透明度を維持します。',
		'en-US': 'Limits lightness to a range with separately softened lower and upper boundaries, preserving unaffected midtones and alpha.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	thumbnail: {
		mode: 'customParameters',
		params: { lowerLimit: 0.25, upperLimit: 0.72 },
	},
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		lowerLimit: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Lower Limit (Oklab L)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.1,
		},
		lowerSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Lower Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.2,
		},
		upperLimit: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Upper Limit (Oklab L)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.9,
		},
		upperSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Upper Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.2,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
