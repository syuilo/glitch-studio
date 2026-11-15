import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'irisWipe',
	displayName: 'Iris Wipe',
	description: {
		'ja-JP': '円の境界を広げる、または縮めることで、画像Aから画像Bへ切り替えます。',
		'en-US': 'Transitions from image A to image B with an expanding or contracting circle.',
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
		center: {
			dataType: { kind: 'vector' },
			ui: { label: 'Center', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		direction: {
			dataType: { kind: 'enum', options: ['outward', 'inward'] },
			ui: { label: 'Direction', control: { labels: { outward: 'Outward', inward: 'Inward' } } },
			defaultValue: { inputSource: 'literal', value: 'outward' },
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
		output: { dataType: { kind: 'color' }, canLazyAllocation: true },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});

