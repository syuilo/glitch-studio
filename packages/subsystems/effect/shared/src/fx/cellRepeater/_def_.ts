import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'cellRepeater',
	displayName: 'Cell Repeater',
	description: {
		'ja-JP': '最大10個の入力画像・色を格子状のセルへ反復配置します。各セル内で制御入力をサンプリングし、素材の選択・不透明度・移動・拡縮・回転を設定します。描画はセル境界で切り取ります。',
		'en-US': 'Repeats up to 10 input images or colors in grid cells. Samples control inputs within each cell to select its input, opacity, translation, scale, and rotation. Clips drawing to cell boundaries.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['pattern', 'transform'],
	paramDefs: {
		inputs: {
			dataType: { kind: 'array', elementType: { kind: 'color' } },
			ui: { label: 'Inputs', control: { element: {} } },
			maxElements: 10,
			defaultValue: {
				inputSource: 'literal',
				value: [{ id: 'first', binding: { inputSource: 'literal', value: [1, 1, 1, 1] } }],
			},
			element: { canNode: true, defaultValue: { inputSource: 'literal', value: [1, 1, 1, 1] } },
		},
		// 格子自体は全体共通の値にする。素材10個と制御5個で、テクスチャ入力は最大15個。
		frequency: {
			dataType: { kind: 'vector' },
			ui: { label: 'Frequency', control: { controlType: 'dimension', min: 0.01, max: 1000, logarithmic: true } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: [10, 10] },
		},
		// 画面上の距離ではなくセルの周期が単位。1で回転後の格子を1セル分ずらす。
		phase: {
			dataType: { kind: 'vector' },
			ui: { label: 'Phase', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		fitMode: {
			dataType: { kind: 'fitMode' },
			ui: { label: 'Fit Mode', control: {} },
			defaultValue: { inputSource: 'literal', value: 'cover' },
		},
		// 各制御入力は変形前のセル内で平均する。Selectionは平均後の0〜1を素材数で均等分割する。
		perCellSelection: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Per Cell Selection', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		perCellOpacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Per Cell Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		// Cellではセル幅／高さ1つ分、Screenでは画面幅／高さの半分を移動量1とする。
		// 個別のScaleでは単位を変えず、Angleで移動方向は回さない。
		perCellTranslation: {
			dataType: { kind: 'vector' },
			ui: { label: 'Per Cell Translation', control: { controlType: 'vector', min: -2, max: 2, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		translationUnit: {
			dataType: { kind: 'enum', options: ['cell', 'screen'] },
			ui: {
				label: 'Translation Unit',
				control: { labels: { cell: 'Cell', screen: 'Screen' } },
			},
			defaultValue: { inputSource: 'literal', value: 'cell' },
		},
		perCellScale: {
			dataType: { kind: 'vector' },
			ui: { label: 'Per Cell Scale', control: { controlType: 'dimension', min: -1, max: 4, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [1, 1] },
		},
		perCellRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Per Cell Rotation', control: { controlType: 'angle' } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		controlSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Control Samples', control: { controlType: 'range', min: 1, max: 256, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	// 素材の配列要素を主入力にはしない。自動解像度は全素材の最大画素数から求める。
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
