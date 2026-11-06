import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'position',
	displayName: 'Position',
	description: {
		'ja-JP': '描画領域の位置を、中央原点・長辺全体が1・上が+Yのベクトル場として生成します。',
		'en-US': 'Generates a centered position field with a unit long side and upward positive Y.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['math', 'utility'],
	paramDefs: {},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'vector' } } },
	primaryOutput: 'output',
});
