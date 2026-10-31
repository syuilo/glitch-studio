import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'kaleidoscope',
	displayName: 'Kaleidoscope',
	description: {
		'ja-JP': '入力画像の扇形領域を円周方向に反復し、鏡映の有無を切り替えられる万華鏡のような模様を作ります。',
		'en-US': 'Repeats a wedge of the input image around a center, with optional mirroring, to create a kaleidoscope pattern.',
	},
	kind: 'modify',
	dependsOnRenderHistory: false,
	tags: ['transform', 'pattern'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		input: {
			dataType: { kind: 'color' },
			ui: { label: 'Input', control: {} },
			canNode: true,
			defaultValue: { inputSource: 'literal', value: [0, 0, 0, 0] },
		},
		// 円周方向の反復数。Angular Skewが0で6なら、Mirror ONで30°の扇形が12枚、OFFで60°の扇形が6枚並ぶ。
		repetitions: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Repetitions',
				control: {
					controlType: 'range',
					min: 1,
					max: 32,
					step: 1,
				},
			},
			defaultValue: { inputSource: 'literal', value: 6 },
		},
		// 円周方向の鏡映だけを切り替える。Radial Repeatの半径方向の鏡映は維持する。
		mirror: {
			dataType: { kind: 'bool' },
			ui: { label: 'Mirror', control: {} },
			defaultValue: { inputSource: 'literal', value: true },
		},
		// Mirror ON時の往復の幅を変える。正なら上向きの基準から時計回りに進む側を広げる。
		// ±1では片側の幅が0になり、鏡映の折り返しが周期境界へ移動する。
		angularSkew: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Angular Skew',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		center: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Center',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		rotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		// 出力の縦半径だけ進むごとの回転数。正なら外側ほど対称軸を時計回りにねじる。
		// 1と0は同じ形にならないため、周期的な角度ではなく連続量として操作する。
		twist: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Twist',
				control: {
					controlType: 'range',
					min: -2,
					max: 2,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		// 出力の縦半径に含まれる往復周期の数。0では無効、小数も許可する。
		// 各周期は半径方向を等倍で進んで戻る。模様の拡大率はZoomで独立に調整する。
		radialRepeat: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Radial Repeat',
				control: {
					controlType: 'range',
					min: 0,
					max: 16,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		// Radial Repeatの往復周期をずらす。1ごとに同じ模様へ戻り、反復が無効なら影響しない。
		// 値を増やすと模様が外側へ、減らすと中心へ移動する。
		radialPhase: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Radial Phase',
				control: {
					controlType: 'range',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		sourceCenter: {
			dataType: { kind: 'vector' },
			ui: {
				label: 'Source Center',
				control: {
					controlType: 'vector',
					min: -1,
					max: 1,
					step: 0.01,
				},
			},
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		sourceRotation: {
			dataType: { kind: 'scalar' },
			ui: { label: 'Source Rotation', control: { controlType: 'angle' } },
			defaultValue: { inputSource: 'literal', value: 0 },
		},
		zoom: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Zoom',
				control: {
					controlType: 'range',
					min: 0.01,
					max: 8,
					step: 0.01,
				},
			},
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
