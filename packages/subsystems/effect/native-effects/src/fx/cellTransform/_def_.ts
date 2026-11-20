import { defineNativeEffect } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { cellSubdivisionParameterDefinitions } from '../../cell-subdivision.ts';

export default defineNativeEffect({
	displayName: 'Cell Transform',
	summary: {
		'ja-JP': '入力画像を格子状に分割し、各部分の参照元の位置を指定したり、移動・拡縮・回転させたりします。',
		'en-US': 'Splits the input image into grid cells with per-cell source positions, translation, scale, and rotation.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform', 'pattern'],
	paramDefs: {
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		// Frequencyは最も粗い格子の密度。個別の変形がなければ、分割方法を変えても元画像を保つ。
		frequency: {
			dataType: { kind: 'vector' },
			ui: { label: 'Frequency', control: { controlType: 'dimension', min: 0.01, max: 1000, logarithmic: true } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: [10, 10] },
		},
		// Phaseは回転後の格子の周期が単位。1で分割位置を1セル分ずらす。
		phase: {
			dataType: { kind: 'vector' },
			ui: { label: 'Phase', control: { controlType: 'vector', min: -1, max: 1, step: 0.01 } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		// 画像自体の回転ではなく分割線の向き。正値で時計回り、1で1周。
		angle: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Angle', control: { controlType: 'angle' } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		// セル寸法の基準領域。入力画像のfitは接続設定で画面全体へ適用する。
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		...cellSubdivisionParameterDefinitions,
		sourcePositionMode: {
			dataType: { kind: 'enum', options: ['cell', 'input'] },
			ui: { label: 'Source Position Mode', control: { labels: { cell: 'Cell Center', input: 'Input' } } },
			defaultValue: { inputSource: 'literal', value: 'cell' },
		},
		// Inputでは切り出す領域の中心を共通座標で指定する。セル番号へのスナップはせず、
		// 拡縮・回転・移動はこの領域の内容へ適用するため、参照元の中心自体は動かさない。
		perCellSourcePosition: {
			dataType: { kind: 'vector' },
			ui: { label: 'Per Cell Source Position', control: { controlType: 'vector', min: -0.5, max: 0.5, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		perCellOpacity: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Per Cell Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: 1 },
		},
		// Cellではセル幅／高さ1つ分、Canvasでは長辺全体を移動量1とする。
		// 個別のScaleでは単位を変えず、Angleで移動方向は回さない。
		perCellTranslation: {
			dataType: { kind: 'vector' },
			ui: { label: 'Per Cell Translation', control: { controlType: 'vector', min: -2, max: 2, step: 0.01 } },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		translationUnit: {
			dataType: { kind: 'enum', options: ['cell', 'canvas'] },
			ui: {
				label: 'Translation Unit',
				control: { labels: { cell: 'Cell', canvas: 'Canvas' } },
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
		// Cellでは各セルの画像片、Imageでは入力画像全体を基準に余白を埋める。
		wrapReference: {
			dataType: { kind: 'enum', options: ['cell', 'image'] },
			ui: {
				label: 'Wrap Reference',
				control: { labels: { cell: 'Cell', image: 'Image' } },
			},
			defaultValue: { inputSource: 'literal', value: 'cell' },
		},
		cellWrapMode: {
			dataType: { kind: 'wrapMode' },
			ui: { label: 'Wrap Mode', control: {} },
			defaultValue: { inputSource: 'literal', value: 'transparent' },
		},
		controlSamples: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Control Samples', control: { controlType: 'range', min: 1, max: 256, step: 1 } },
			defaultValue: { inputSource: 'literal', value: 1 },
		},
	},
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
