import { srgbToLinearSrgb } from '@gs/shared/color-space.ts';
import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'heightLighting',
	displayName: 'Height Lighting',
	description: {
		'ja-JP': '高さ場の凹凸に方向光と環境光を当て、入力画像に陰影を加えます。',
		'en-US': 'Shades the input image using a height field, directional light, and hemispherical ambient light.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['light'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Base Color', control: {} },
			canNode: true,
			// 高さ場だけを接続しても陰影を確認できるよう、不透明な白を既定値にする。
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
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
		lightAngle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 315 / 360 },
		},
		lightElevation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Elevation (Turns)', control: { controlType: 'range', min: -0.25, max: 0.25, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.125 },
		},
		lightColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Light Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		lightIntensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Intensity', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.8 },
		},
		lightWrap: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Light Wrap', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		ambientFrontColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Ambient Front Color', control: {} },
			defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] },
		},
		ambientBackColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Ambient Back Color', control: {} },
			defaultValue: { inputSource: 'literal', value: srgbToLinearSrgb([0.2, 0.25, 0.3, 1]) },
		},
		ambientIntensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Ambient Intensity', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.4 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
