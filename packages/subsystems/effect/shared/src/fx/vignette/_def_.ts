import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'vignette',
	displayName: 'Vignette',
	description: {
		'ja-JP': '透明度を保ちながら、楕円の外側へ向かって画像を滑らかに暗くします。',
		'en-US': 'Smoothly darkens the image outside an ellipse while preserving transparency.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['color', 'light'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size', control: { controlType: 'dimension', min: 0, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0.8, 0.8] },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		feather: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Feather', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.4 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});
