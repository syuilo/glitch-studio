import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'sdfToMask',
	displayName: 'SDF to Mask',
	description: {
		'ja-JP': '内側が負の符号付き距離場から、塗り・輪郭の0〜1のマスクを生成します。距離・線幅・フェザーは描画領域の高さを1とし、画素に応じたアンチエイリアスにも対応します。',
		'en-US': 'Converts a negative-inside signed distance field into a fill or stroke mask in the range 0–1. Offset, stroke width, and feather use render-height units. Supports pixel-adaptive anti-aliasing.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['math', 'convert', 'sdf'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Input', control: { controlType: 'number', step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 65504 },
		},
		mode: {
			dataType: { kind: 'enum', options: ['fill', 'stroke'] },
			ui: { label: 'Mode', control: { labels: { fill: 'Fill', stroke: 'Stroke' } } },
			defaultValue: { inputSource: 'literal', value: 'fill' },
		},
		offset: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Offset (Reference Ratio)', control: { controlType: 'number', step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		strokeWidth: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Stroke Width (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0.01 },
		},
		strokeAlignment: {
			dataType: { kind: 'enum', options: ['inside', 'center', 'outside'] },
			ui: { label: 'Stroke Alignment', control: { labels: { inside: 'Inside', center: 'Center', outside: 'Outside' } } },
			defaultValue: { inputSource: 'literal', value: 'center' },
		},
		feather: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Feather (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.1, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		antiAlias: {
			dataType: { kind: 'bool' },
			ui: { label: 'Anti-alias', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		invert: {
			dataType: { kind: 'bool' },
			ui: { label: 'Invert', control: {} },
			defaultValue: { inputSource: 'literal', value: false },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
