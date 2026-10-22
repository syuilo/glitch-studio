import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidGlass',
	displayName: 'Liquid Glass',
	description: {
		'ja-JP': 'マスクの輪郭に丸みを付け、背景の屈折と光沢を持つガラスを描画します。',
		'en-US': 'Creates rounded glass along a mask contour with background refraction and highlights.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'light', 'liquid', 'stylized'],
	paramDefs: {
		background: {
			dataType: { kind: 'color' },
			ui: { label: 'Background', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		mask: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Mask', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		bevelWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Bevel Width', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.12 },
		},
		surfaceHeight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Surface Height', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.06 },
		},
		refractionStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Refraction Strength', control: { controlType: 'range', min: -1, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		highlightStrength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Strength', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.8 },
		},
		lightDirection: {
			dataType: { kind: 'vector' },
			ui: { label: 'Light Direction', control: { controlType: 'xy', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [-0.6, 0.8] },
		},
		tint: {
			dataType: { kind: 'color' },
			ui: { label: 'Tint', control: {} },
			defaultValue: { inputSource: 'literal', value: [0.8, 0.93, 1, 0.04] },
		},
	},
	primaryInputParameter: 'background',
	resolutionInputParameter: 'background',
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
