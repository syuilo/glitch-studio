import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Pixel Stretch',
	summary: {
		'ja-JP': '直線上の色を片側へ引き伸ばし、帯状のグリッチを作ります。',
		'en-US': 'Stretches pixels from a straight edge to create streaks on one side.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['distortion', 'glitch'],
	thumbnail: { mode: 'customParameters', params: { position: 0.56, angle: 0.11 } },
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		position: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Position', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0.5,
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'color' } } },
	primaryOutput: 'output',
});
