import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'liquidGlass',
	displayName: 'Liquid Glass',
	description: {
		'ja-JP': 'マスクの輪郭に丸みを付け、屈折・ぼかし・色分散・表面の揺らぎを持つガラスを描画します。',
		'en-US': 'Creates rounded glass along a mask contour with refraction, blur, dispersion, and surface waviness.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'blur', 'light', 'liquid', 'stylized'],
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
		blurRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Radius', control: { controlType: 'range', min: 0, max: 0.2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		blurSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Samples', control: { controlType: 'range', min: 4, max: 64, step: 2 } },
			defaultValue: { inputSource: 'literal', value: 24 },
		},
		dispersion: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Dispersion', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		surfaceWavinessAmplitude: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Waviness Amplitude', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		surfaceWavinessScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Waviness Scale', control: { controlType: 'range', min: 0.01, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		surfaceWavinessSpeed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Waviness Speed', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		surfaceWavinessSeed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Waviness Seed', control: { controlType: 'seed' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		// 再生時刻への依存をパラメータとして明示し、Visual Moduleの描画キャッシュへ伝える。
		// ノード入力にすると16bitテクスチャへ丸められる場合があるため、通常の数値・式として扱う。
		time: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Time', control: { controlType: 'number', step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
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
