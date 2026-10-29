import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'sdfBoolean',
	displayName: 'SDF Boolean',
	description: {
		'ja-JP': '内側が負の符号付き距離場を和集合・共通部分・差分（AからBを除く）で合成します。Smoothingで接合部を滑らかにします。合成後の最短距離は再計算しません。',
		'en-US': 'Combines negative-inside signed distance fields using union, intersection, or difference (A minus B). Smoothing blends the junctions. Does not recalculate exact distances after combining.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['composite', 'math'],
	paramDefs: {
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
			ui: { label: 'Smoothing (Height Units)', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: 'inputA',
	resolutionInputParameter: null,
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
