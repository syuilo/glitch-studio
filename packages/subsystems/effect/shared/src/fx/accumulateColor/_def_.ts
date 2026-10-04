import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'accumulateColor',
	displayName: 'Accumulate (Color)',
	description: {
		'ja-JP': 'RGBを時間とともに蓄積し、減衰させます。アルファ値は蓄積せず、現在の入力値を維持します。',
		'en-US': 'Accumulates and fades RGB over time, preserving the current input alpha without accumulating it.',
	},
	kind: 'modify',
	tags: ['temporal', 'color', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		strengthFactor: { dataType: { kind: 'color' }, ui: { label: 'Strength factor', control: { controlType: 'signal' } }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms, 0 = infinite)', control: { controlType: 'range', min: 0, max: 10000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
		halfLifeFactor: { dataType: { kind: 'color' }, ui: { label: 'Half-life factor', control: { controlType: 'signal' } }, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
