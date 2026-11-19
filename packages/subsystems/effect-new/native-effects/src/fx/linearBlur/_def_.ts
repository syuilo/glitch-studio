import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { MIN_LINEAR_BLUR_SAMPLES, MAX_LINEAR_BLUR_SAMPLES } from './sampling.ts';

export default defineNativeEffect({
	displayName: 'Linear Blur',
	summary: {
		'ja-JP': '指定した方向へ直線状に画像をぼかします。中心の保護、色分散、軌跡の偏り、ハイライトの強調を調整できます。',
		'en-US': 'Blurs the image along a direction, with a protected center zone, spectral dispersion, directional bias, and highlight emphasis.',
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
		length: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Blur Length', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			// 画素数ではなく基準寸法に対する全長を公開し、解像度を変えても同じ長さでぼかす。
			defaultValue: { inputSource: 'literal', value: 0.05 },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
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
			ui: { label: 'Samples', control: { controlType: 'range', min: MIN_LINEAR_BLUR_SAMPLES, max: MAX_LINEAR_BLUR_SAMPLES, step: 1 } },
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
