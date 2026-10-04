import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'composeVector',
	displayName: 'Compose Vector',
	description: {
		'ja-JP': 'X成分とY成分の入力を組み合わせ、2次元ベクトルを作ります。',
		'en-US': 'Combines X and Y inputs into a two-dimensional vector.',
	},
	kind: 'generate',
	tags: ['math', 'utility'],
	paramDefs: {
		x: { dataType: { kind: 'scalar' }, ui: { label: 'X', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
		y: { dataType: { kind: 'scalar' }, ui: { label: 'Y', control: { controlType: 'number', step: 0.01 } }, canNode: true, defaultValue: { inputSource: 'literal', value: 0 } },
	},
	primaryInputParameter: null,
	resolutionInputParameter: null,
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
	},
	primaryOutput: 'output',
});
