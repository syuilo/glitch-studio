import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Compose Vector (Polar)',
	summary: {
		'ja-JP': '角度と長さから2次元ベクトルを作ります。',
		'en-US': 'Creates a two-dimensional vector from angle and length.',
	},
	kind: 'generate',
	thumbnail: { mode: 'none' },
	dependsOnRenderHistory: false,
	tags: ['math', 'utility', 'convert'],
	paramDefs: {
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: 0,
		},
		length: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Length', control: { controlType: 'number', min: 0, step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: ['angle', 'length'],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
