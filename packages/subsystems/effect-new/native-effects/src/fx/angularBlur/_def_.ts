import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { MIN_ANGULAR_BLUR_SAMPLES, MAX_ANGULAR_BLUR_SAMPLES } from './sampling.ts';

export default defineNativeEffect({
	displayName: 'Angular Blur',
	summary: {
		'ja-JP': '中心の周りの円弧に沿って画像をぼかします。中心の保護、色分散、軌跡の偏り、ハイライトの強調を調整できます。',
		'en-US': 'Blurs the image along arcs around a center, with a protected focus zone, spectral dispersion, directional bias, and highlight emphasis.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['blur', 'light'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Angle', control: { controlType: 'angle' } },
			canNode: true,
			// 元のIntensity=20は総角度0.1rad。角度の保存値・式・場はturnへ統一する。
			defaultValue: { inputSource: 'literal', value: 0.1 / (2 * Math.PI) },
		},
		focusRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Focus Radius', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		dispersion: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Dispersion', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		dispersionFalloff: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Dispersion Falloff', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		bias: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Bias', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		highlights: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Highlights', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		jitter: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Jitter', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		samples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Samples', control: { controlType: 'range', min: MIN_ANGULAR_BLUR_SAMPLES, max: MAX_ANGULAR_BLUR_SAMPLES, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 32 },
		},
		seed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Seed', control: { controlType: 'number', step: 1 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
