import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'remap',
	displayName: 'Remap',
	description: {
		'ja-JP': '入力の数値を、指定した入力範囲から出力範囲へ変換します。',
		'en-US': 'Remaps input values from a specified input range to an output range.',
	},
	kind: 'modify',
	tags: ['math', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'number' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMin: { dataType: { kind: 'scalar' }, ui: { label: 'In Min', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		inMax: { dataType: { kind: 'scalar' }, ui: { label: 'In Max', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
		outMin: { dataType: { kind: 'scalar' }, ui: { label: 'Out Min', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		outMax: { dataType: { kind: 'scalar' }, ui: { label: 'Out Max', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 1 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
