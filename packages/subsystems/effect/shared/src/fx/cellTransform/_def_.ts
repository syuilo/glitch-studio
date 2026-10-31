import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'cellTransform',
	displayName: 'Cell Transform',
	description: {
		'ja-JP': '入力画像を格子状のセルへ分割し、各セルの不透明度・移動・拡縮・回転を制御します。制御入力は変形前のセル内でサンプリングし、描画は元のセル境界で切り取ります。Angleは分割格子だけを回転します。',
		'en-US': 'Splits the input image into grid cells with individual opacity, translation, scale, and rotation. Samples control inputs within each original cell and clips drawing to its boundaries. Angle rotates only the dividing grid.',
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
		// 格子の配置は全体共通。個別の変形がなければ、分割方法を変えても元画像を保つ。
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
		fitMode: {
			dataType: { kind: 'fitMode' },
			ui: { label: 'Fit Mode', control: {} },
			defaultValue: { inputSource: 'literal', value: 'cover' },
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
	primaryInputParameter: 'input',
	resolutionInputParameters: ['input'],
	outputDefs: {
		output: { dataType: { kind: 'color' } },
	},
	primaryOutput: 'output',
});
