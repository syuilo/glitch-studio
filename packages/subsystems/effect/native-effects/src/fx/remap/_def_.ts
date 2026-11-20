import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';

export default defineNativeEffect({
	displayName: 'Remap',
	summary: {
		'ja-JP': '入力の数値を、指定した入力範囲から出力範囲へ変換します。',
		'en-US': 'Remaps input values from a specified input range to an output range.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'number' } },
			canNode: true,
			defaultValue: 0,
		},
		inMin: {
			dataType: { kind: 'scalar' },
			ui: { label: 'In Min', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		inMax: {
			dataType: { kind: 'scalar' },
			ui: { label: 'In Max', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
		outMin: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Out Min', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 0,
		},
		outMax: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Out Max', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: 1,
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
