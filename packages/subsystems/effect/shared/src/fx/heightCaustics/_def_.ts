import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'heightCaustics',
	displayName: 'Height Caustics',
	description: {
		'ja-JP': '高さ場で屈折した平行光を受光面へ集め、コースティクスの画像と照度を生成します。',
		'en-US': 'Refracts parallel light through a height field to generate caustic images and irradiance on a receiving plane.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['light', 'simulation'],
	paramDefs: {
		height: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Height', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		heightScale: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Height Scale (Long Side Ratio)', control: { controlType: 'range', min: -0.2, max: 0.2, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		receiverDistance: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Receiver Distance (Long Side Ratio)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.2 },
		},
		ior: {
			dataType: { kind: 'scalar' },
			ui: { label: 'IOR', control: { controlType: 'range', min: 1, max: 3, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 1.333 },
		},
		lightAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		lightElevation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Elevation (Turns)', control: { controlType: 'range', min: 0, max: 0.25, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.25 },
		},
		lightColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Light Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		lightIntensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Intensity', control: { controlType: 'range', min: 0, max: 5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		softness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Softness (Long Side Ratio)', control: { controlType: 'range', min: 0, max: 0.05, step: 0.0005 } },
			defaultValue: { inputSource: 'literal', value: 0.004 },
		},
		samples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Samples (Long Side)', control: { controlType: 'range', min: 32, max: 1024, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 512 },
		},
	},
	primaryInputParameter: 'height',
	resolutionInputParameters: ['height'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		irradiance: { dataType: { kind: 'scalar' }, canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
