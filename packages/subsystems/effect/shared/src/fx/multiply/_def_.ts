import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'multiply',
	displayName: 'multiply',
	description: {
		'ja-JP': '入力のスカラー値に指定した数値を掛けます。',
		'en-US': 'Multiplies the scalar input by the specified value.',
	},
	kind: 'modify',
	tags: ['math', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'scalar' }, ui: { label: 'Input', control: { controlType: 'number' } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		v: { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 2 } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
