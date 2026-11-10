import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'filmColor',
	displayName: 'Film Color',
	description: {
		'ja-JP': '柔らかな階調、高彩度部の圧縮、明暗別の色付けでフィルム写真のような色合いを作ります。',
		'en-US': 'Creates film-inspired colors with soft tonal transitions, chroma compression, and separate shadow and highlight tints.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'stylized'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		amount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		contrast: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Contrast', control: { controlType: 'range', min: 0.5, max: 2, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1.1 },
		},
		shadowSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		highlightSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.35 },
		},
		fade: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fade', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		chromaCompression: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Chroma Compression', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.2 },
		},
		shadowHue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Hue', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.55 },
		},
		shadowTintAmount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Shadow Tint Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		highlightHue: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Hue', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.22 },
		},
		highlightTintAmount: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Tint Amount', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
