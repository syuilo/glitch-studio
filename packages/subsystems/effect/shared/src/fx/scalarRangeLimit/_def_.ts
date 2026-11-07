import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'scalarRangeLimit',
	displayName: 'Scalar Range Limit',
	description: {
		'ja-JP': 'スカラー入力を、クランプ・繰り返し・反転する繰り返しで指定範囲内に収めます。',
		'en-US': 'Keeps scalar values within a specified range by clamping, wrapping, or ping-pong reflection.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		min: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Min', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		max: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Max', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		mode: {
			dataType: { kind: 'enum', options: ['clamp', 'wrap', 'pingPong'] },
			ui: { label: 'Mode', control: { labels: { clamp: 'Clamp', wrap: 'Wrap', pingPong: 'Ping-pong' } } },
			defaultValue: { inputSource: 'literal', value: 'clamp' },
		},
	},
	primaryInputParameter: 'input',
	// 上下限も空間的に変化する入力場なので、主入力が定数でもその解像度を利用する。
	resolutionInputParameters: ['input', 'min', 'max'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
