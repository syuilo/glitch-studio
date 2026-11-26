import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Tone Compression',
	summary: {
		'ja-JP': '暗部を黒から持ち上げ、明部を圧縮します。それぞれの明度の閾値・なだらかさ・補正量を調整でき、HDRの階調差を保持します。',
		'en-US': 'Lifts shadows including black and compresses highlights, with separate lightness thresholds, softness, and amounts while retaining HDR tonal differences.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color'],
	thumbnail: {
		mode: 'customParameters',
		params: { shadowThreshold: 0.45, shadowAmount: 0.75, highlightThreshold: 0.65, highlightAmount: 0.75 },
	},
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		shadowThreshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Threshold (Oklab L)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.3,
		},
		shadowSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.2,
		},
		shadowAmount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.5,
		},
		highlightThreshold: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Threshold (Oklab L)', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.8,
		},
		highlightSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.2,
		},
		highlightAmount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: 0.5,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
