import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'feedback',
	displayName: 'Feedback',
	description: {
		'ja-JP': '入力を時間とともに加算・減衰、または過去の値と補間します。補間ではHalf-lifeに応じてStrength適用後の入力に近づきます。全チャンネルをデータとして扱います。',
		'en-US': 'Adds and fades input over time, or interpolates history toward the strength-scaled input using the half-life. Treats all channels as data.',
	},
	kind: 'modify',
	tags: ['temporal', 'utility'],
	paramDefs: {
		input: { dataType: { kind: 'any' }, ui: { label: 'Input', control: {} }, canNode: true, defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] } },
		mode: { dataType: { kind: 'enum', options: ['add', 'interpolate'] }, ui: { label: 'Mode', control: { labels: { add: 'Add', interpolate: 'Interpolate' } } }, defaultValue: { inputSource: 'literal', value: 'add' } },
		strength: { dataType: { kind: 'scalar' }, ui: { label: 'Strength', control: { controlType: 'range', min: 0, max: 10, step: 0.01 } }, defaultValue: { inputSource: 'literal', value: 1 } },
		halfLife: { dataType: { kind: 'scalar' }, ui: { label: 'Half-life (ms)', control: { controlType: 'range', min: 0, max: 10000, step: 1 } }, defaultValue: { inputSource: 'literal', value: 300 } },
		reset: { dataType: { kind: 'bool' }, ui: { label: 'Reset', control: {} }, defaultValue: { inputSource: 'literal', value: false } },
	},
	primaryInputParameter: 'input',
	resolutionInputParameter: 'input',
	outputDefs: {
		output: { dataType: { kind: 'any' } },
	},
	primaryOutput: 'output',
});
