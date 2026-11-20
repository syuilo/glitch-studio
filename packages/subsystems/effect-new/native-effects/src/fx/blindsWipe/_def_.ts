import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Blinds Wipe',
	summary: {
		'ja-JP': '複数の帯をブラインドのように開き、画像Aから画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B by opening a series of parallel bands.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition'],
	paramDefs: {
		inputA: {
			dataType: { kind: 'color' },
			ui: { label: 'A', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		inputB: {
			dataType: { kind: 'color' },
			ui: { label: 'B', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		progress: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Progress', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		count: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Count', control: { controlType: 'range', min: 1, max: 128, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 8 },
		},
		mode: {
			dataType: { kind: 'enum', options: ['oneSided', 'centered'] },
			ui: { label: 'Opening', control: { labels: { oneSided: 'One-sided', centered: 'Centered' } } },
			defaultValue: { inputSource: 'literal', value: 'oneSided' },
		},
		stagger: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Stagger', control: { controlType: 'range', min: -1, max: 1, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		feather: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Feather (Reference Ratio)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sizeReference: {
			dataType: { kind: 'sizeReference' },
			ui: { label: 'Size Reference', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: 'longSide' },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', inputParameters: ['progress', 'angle', 'count', 'mode', 'stagger', 'feather', 'sizeReference'] },
	},
	primaryOutput: 'output',
});
