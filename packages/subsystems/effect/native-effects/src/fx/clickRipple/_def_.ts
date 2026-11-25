import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Click Ripple',
	summary: {
		'ja-JP': 'クリックやタップの位置から広がる波紋を、変位のベクトル場と波の山のマスクとして生成します。',
		'en-US': 'Generates expanding ripples from clicks and taps as a displacement field and a crest mask.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['temporal', 'interactive', 'distortion'],
	paramDefs: {
		speed: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Speed', control: { controlType: 'range', min: 0, max: 4, step: 0.01 } },
			defaultValue: 0.65,
		},
		duration: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Duration (s)', control: { controlType: 'range', min: 0.05, max: 10, step: 0.01 } },
			defaultValue: 1,
		},
		wavelength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Wavelength', control: { controlType: 'range', min: 0.005, max: 0.3, step: 0.001 } },
			defaultValue: 0.04,
		},
		width: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Width', control: { controlType: 'range', min: 0.005, max: 1, step: 0.001 } },
			defaultValue: 0.12,
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 2, step: 0.01 } },
			defaultValue: 1,
		},
		reflectivity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Reflectivity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: 0,
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { label: 'Displacement', dataType: { kind: 'vector' } },
		mask: { label: 'Mask', dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
