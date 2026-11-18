import type { NativeEffectDefinition } from '../../native-effect-definition.ts';

export default {
	displayName: 'Decompose Vector',
	summary: {
		'ja-JP': '2次元ベクトルをX成分とY成分のスカラー値に分解します。',
		'en-US': 'Splits a two-dimensional vector into X and Y scalar components.',
	},
	tags: ['math', 'utility', 'convert'],
	kind: 'modify',
	paramDefs: {
		input: {
			dataType: { kind: 'vector' },
			ui: { label: 'Input', control: { controlType: 'vector' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
	},
	outputDefs: {
		x: { dataType: { kind: 'scalar' } },
		y: { dataType: { kind: 'scalar' } },
	},
	primaryInputId: 'input',
	primaryOutputId: 'x',
} satisfies NativeEffectDefinition;
