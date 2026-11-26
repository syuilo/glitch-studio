import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { gradientInterpolationParameter } from '../../gradient-interpolation.ts';

export default defineNativeEffect({
	displayName: 'Click Gradient',
	summary: {
		'ja-JP': '画面を押した位置から広がる円形のグラデーションと、その勾配を生成します。',
		'en-US': 'Generates an expanding circular gradient and its slope from each pointer press.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['gradient', 'temporal', 'interactive'],
	paramDefs: {
		speed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Speed', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: 0.65,
		},
		width: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Width', control: { controlType: 'range', min: 0.005, max: 1, step: 0.001 } },
			defaultValue: 0.12,
		},
		duration: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Duration (s)', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: 0,
		},
		reflectivity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Reflectivity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0,
		},
		interpolation: { ...gradientInterpolationParameter, defaultValue: { type: 'smoothstep' } },
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		scalar: { dataType: { kind: 'scalar' } },
		vector: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'scalar',
});
