import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import { MIN_ZOOM_BLUR_SAMPLES, MAX_ZOOM_BLUR_SAMPLES } from './sampling.ts';

export default defineNativeEffect({
	displayName: 'Zoom Blur',
	summary: {
		'ja-JP': '中心から放射状に画像をぼかします。中心の保護、色分散、ハイライトの強調、渦状の軌跡を調整できます。',
		'en-US': 'Blurs the image radially from a center, with a protected focus zone, spectral dispersion, highlight emphasis, and spiral streaks.',
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
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.3 },
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
		spiral: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Spiral', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
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
			ui: { label: 'Samples', control: { controlType: 'range', min: MIN_ZOOM_BLUR_SAMPLES, max: MAX_ZOOM_BLUR_SAMPLES, step: 1 } },
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
