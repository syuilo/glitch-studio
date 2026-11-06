import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'normalizeVector',
	displayName: 'Normalize Vector',
	description: {
		'ja-JP': '2次元ベクトルの方向を保ち、長さを1に揃えます。',
		'en-US': 'Normalizes a two-dimensional vector to length one while preserving its direction.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {
		input: {
			dataType: { kind: 'vector' },
			ui: { label: 'Input', control: { controlType: 'vector' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
