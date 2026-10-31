import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'glass',
	displayName: 'Glass',
	description: {
		'ja-JP': '2Dの符号付き距離場を形状として、入力画像にガラスの屈折・ぼかし・色収差・ハイライトを加えます。二次減衰または曲面のCurvature・IORによる屈折を選べます。SDFは内側が負、距離の単位は描画領域の高さを1とします。',
		'en-US': 'Refracts, blurs, and lights an image through a negative-inside 2D SDF in render-height units. Choose quadratic falloff or a curved surface controlled by curvature and IOR.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'light', 'sdf'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		sdf: {
			dataType: { kind: 'scalar' },
			ui: { label: 'SDF', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 65504 },
		},
		refractionModel: {
			dataType: { kind: 'enum', options: ['quadratic', 'curvedSurface'] },
			ui: { label: 'Refraction Model', control: { labels: { quadratic: 'Quadratic', curvedSurface: 'Curved Surface' } } },
			defaultValue: { inputSource: 'literal', value: 'quadratic' },
		},
		refraction: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Refraction', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		thickness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Thickness (Height Units)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.03 },
		},
		curvature: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Curvature (Curved Surface)', control: { controlType: 'range', min: 2, max: 6, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 4 },
		},
		ior: {
			dataType: { kind: 'scalar' },
			ui: { label: 'IOR (Curved Surface)', control: { controlType: 'range', min: 1, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1.5 },
		},
		edgeSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Edge Softness (Height Units)', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0001 } },
			defaultValue: { inputSource: 'literal', value: 0.0015 },
		},
		blur: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Radius (Height Units)', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		blurSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Samples', control: { controlType: 'range', min: 1, max: 128, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 24 },
		},
		aberration: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Aberration', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		aberrationSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Aberration Samples', control: { controlType: 'range', min: 3, max: 64, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 3 },
		},
		innerZoom: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Inner Zoom', control: { controlType: 'range', min: 0.1, max: 3, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		innerZoomCenter: {
			dataType: { kind: 'vector' },
			ui: { label: 'Inner Zoom Center', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		lightAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 300 / 360 },
		},
		highlight: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		highlightColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Highlight Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		highlightSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlight Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		fresnel: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fresnel', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		fresnelSoftness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Fresnel Softness', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		fresnelColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Fresnel Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		tintColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Tint Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		tintIntensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Tint Intensity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		tintPreserveLuminosity: {
			dataType: { kind: 'bool' },
			ui: { label: 'Tint Preserve Luminosity', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		cutout: {
			dataType: { kind: 'bool' },
			ui: { label: 'Cutout', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
