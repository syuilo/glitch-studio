import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'shapeSdf',
	displayName: 'Shape SDF',
	description: {
		'ja-JP': '楕円・角丸矩形の境界までの符号付き距離を生成します。内側は負、外側は正で、距離は描画領域の長辺全体を1とします。寸法と角丸半径にはSize Referenceを適用します。',
		'en-US': 'Generates signed distances to an ellipse or rounded rectangle. Negative inside and positive outside. Distance uses one full render long side; size and corner radius use Size Reference.',
	},
	kind: 'generate',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'math', 'sdf'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		shape: {
			dataType: { kind: 'enum', options: ['ellipse', 'rectangle'] },
			ui: { label: 'Shape', control: { labels: { ellipse: 'Ellipse', rectangle: 'Rectangle' } } },
			defaultValue: { inputSource: 'literal', value: 'ellipse' },
		},
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		size: {
			dataType: { kind: 'vector' },
			ui: { label: 'Size (Reference Ratio)', control: { controlType: 'dimension', min: 0, max: 2, step: 0.01 } },
			defaultValue: { inputSource: 'literal', value: [0.5, 0.5] },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		cornerRadius: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Corner Radius (Reference Ratio)', control: { controlType: 'range', min: 0, max: 0.5, step: 0.001 } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: { output: { dataType: { kind: 'scalar' } } },
	primaryOutput: 'output',
});
