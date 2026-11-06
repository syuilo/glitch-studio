import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'sdfBoolean',
	displayName: 'SDF Boolean',
	description: {
		'ja-JP': '符号付き距離場の形状を結合したり、重なりを取り出したり、くり抜いたりします。接合部をなめらかに繋ぐこともできます。',
		'en-US': 'Combines, intersects, or subtracts shapes defined by signed distance fields, with smooth blending at the junctions.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math', 'sdf'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		inputA: {
			dataType: { kind: 'scalar' },
			ui: { label: 'A', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 65504 },
		},
		inputB: {
			dataType: { kind: 'scalar' },
			ui: { label: 'B', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 65504 },
		},
		operation: {
			dataType: { kind: 'enum', options: ['union', 'intersection', 'difference'] },
			ui: { label: 'Operation', control: { labels: { union: 'Union', intersection: 'Intersection', difference: 'Difference (A − B)' } } },
			defaultValue: { inputSource: 'literal', value: 'union' },
		},
		smoothing: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Smoothing (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameters: ['inputA', 'inputB'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
