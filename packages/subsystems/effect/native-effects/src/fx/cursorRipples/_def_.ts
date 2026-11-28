import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Cursor Ripples',
	summary: {
		'ja-JP': 'ポインターの軌跡から広がる水面の波を、歪みに使える変位のベクトル場として出力します。',
		'en-US': 'Generates a displacement field from water-like ripples along the pointer’s path.',
	},
	kind: 'generate',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'interactive', 'distortion'],
	thumbnail: { mode: 'none' },
	paramDefs: {
		intensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Intensity', control: { controlType: 'range', min: 0, max: 20, step: 0.1 } },
			defaultValue: 10,
		},
		decay: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Decay', control: { controlType: 'range', min: 0, max: 20, step: 0.1 } },
			defaultValue: 10,
		},
		radius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Radius', control: { controlType: 'range', min: 0.015, max: 0.15, step: 0.001 } },
			defaultValue: 0.075,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { label: 'Displacement', dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
