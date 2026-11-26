import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Manga Print',
	summary: {
		'ja-JP': '明暗の段階化、ドットトーン、輪郭線、紙の質感で漫画の印刷紙面のような見た目を作ります。',
		'en-US': 'Creates a manga print look with stepped tones, halftone dots, outlines, and paper grain.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['stylized', 'color', 'pattern'],
	thumbnail: { mode: 'customParameters', params: { toneFrequency: 38, outlineWidth: 0.004 } },
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		brightness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Brightness', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			defaultValue: 0,
		},
		contrast: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Contrast', control: { controlType: 'range', min: 0, max: 3, step: 0.01 } },
			defaultValue: 1.15,
		},
		smoothing: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Smoothing', control: { controlType: 'range', min: 0, max: 0.01, step: 0.0001 } },
			defaultValue: 0.001,
		},
		levels: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Tone Levels', control: { controlType: 'range', min: 2, max: 8, step: 1 } },
			defaultValue: 4,
		},
		toneFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Tone Frequency', control: { controlType: 'range', min: 4, max: 400, logarithmic: true } },
			defaultValue: 100,
		},
		toneAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Tone Angle', control: { controlType: 'angle' } },
			defaultValue: 0.125,
		},
		outlineSensitivity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Outline Sensitivity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.8,
		},
		outlineWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Outline Width', control: { controlType: 'range', min: 0, max: 0.02, step: 0.0001 } },
			defaultValue: 0.002,
		},
		outlineStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Outline Strength', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 1,
		},
		paperColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Paper Color (RGB)', control: {} },
			defaultValue: srgbToLinearSrgb([0.94, 0.93, 0.9, 1]),
		},
		inkColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Ink Color (RGB)', control: {} },
			defaultValue: srgbToLinearSrgb([0.09, 0.085, 0.08, 1]),
		},
		paperGrain: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Paper Grain', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0.12,
		},
		paperGrainFrequency: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Paper Grain Frequency', control: { controlType: 'range', min: 10, max: 2000, logarithmic: true } },
			defaultValue: 800,
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'seed' } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
