import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'accumulateColor',
	displayName: 'Accumulate (Color)',
	description: {
		'ja-JP': 'RGBを時間とともに加算・減衰、または過去の値と補間します。補間ではHalf-lifeに応じてStrength適用後の入力に近づきます。アルファ値は現在の入力値を維持します。',
		'en-US': 'Adds and fades RGB over time, or interpolates history toward the strength-scaled input using the half-life. Preserves the current input alpha.',
	},
	kind: 'modify',
	tags: ['temporal', 'color', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'color' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: { dataType: { kind: 'enum', options: ['add', 'interpolate'] }, ui: { label: 'Mode', control: { labels: { add: 'Add', interpolate: 'Interpolate' } } }, defaultValue: { inputSource: 'literal', value: 'add' } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		strengthFactor: { dataType: { kind: 'color' }, ui: { label: 'Strength factor', control: { controlType: 'signal' } }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms)', control: { controlType: 'range', min: 0, max: 10000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
		halfLifeFactor: { dataType: { kind: 'color' }, ui: { label: 'Half-life factor', control: { controlType: 'signal' } }, canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
