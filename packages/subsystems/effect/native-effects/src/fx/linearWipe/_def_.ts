import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Linear Wipe',
	summary: {
		'ja-JP': '直線の境界を移動させ、画像Aから画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B along a moving straight edge.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition'],
	thumbnail: {
		mode: 'customParameters',
		inputs: { inputA: 'sceneA', inputB: 'sceneB' },
		params: { progress: 0.5, angle: 0.095 },
	},
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: [0, 0, 0, 0],
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: 0,
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			defaultValue: 0,
		},
		feather: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Feather (Reference Ratio)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: 0,
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: 'longSide',
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', inputParameters: ['progress', 'angle', 'feather', 'sizeReference'] },
	},
	primaryOutput: 'output',
});

