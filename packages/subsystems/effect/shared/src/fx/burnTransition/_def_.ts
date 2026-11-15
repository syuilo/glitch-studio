import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'burnTransition',
	displayName: 'Burn Transition',
	description: {
		'ja-JP': 'スカラー場に沿って画像Aを侵食し、残る境界を発光させながら画像Bへ切り替えます。',
		'en-US': 'Erodes image A according to a scalar map, revealing image B with a glowing remaining edge.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'transition', 'light'],
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
			defaultValue: { inputSource: 'literal', value: 0.02 },
		},
		edgeWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Edge Width (Map Range)', control: { controlType: 'range', min: 0, max: 1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.08 },
		},
		edgeColor: {
			dataType: { kind: 'color' },
			ui: { label: 'Edge Color', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1, 0.2, 0.01, 1] },
		},
		edgeIntensity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Edge Intensity', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: 2 },
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
		output: { dataType: { kind: 'color' }, canLazyAllocation: true },
		mask: { dataType: { kind: 'scalar' }, label: 'Mask', canLazyAllocation: true },
		edge: { dataType: { kind: 'scalar' }, label: 'Edge', canLazyAllocation: true },
	},
	primaryOutput: 'output',
});

