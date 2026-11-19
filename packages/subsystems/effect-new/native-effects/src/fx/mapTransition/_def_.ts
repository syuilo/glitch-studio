import { defineNativeEffect } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Map Transition',
	summary: {
		'ja-JP': 'スカラー場の値が小さい場所から順に、画像Aを画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B in the order defined by a scalar map.',
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
		map: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Map', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0.5 },
		},
		softness: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Softness (Map Range)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.1 },
		},
		reverse: {
			dataType: { kind: 'bool' },
			ui: { label: 'Reverse Order', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
		antiAlias: {
			dataType: { kind: 'bool' },
			ui: { label: 'Anti-alias', isAdvanced: true, control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB', 'map'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', inputParameters: ['progress', 'map', 'softness', 'reverse', 'antiAlias'] },
	},
	primaryOutput: 'output',
});
