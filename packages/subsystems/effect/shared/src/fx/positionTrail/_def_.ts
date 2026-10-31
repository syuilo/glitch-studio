import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'positionTrail',
	displayName: 'Position Trail',
	description: {
		'ja-JP': 'Positionの移動を、時間とともに減衰するベクトル場と軌跡の強さを表すスカラー場として出力します。移動量は前回描画時のPositionとの差分から求めます。',
		'en-US': 'Outputs changes in Position as a vector field and a scalar trail intensity that fade over time. Motion is measured from Position in the previous render.',
	},
	kind: 'generate',
	dependsOnRenderHistory: true,
	tags: ['temporal', 'utility'],
	paramDefs: {
		sizeReference: { dataType: { kind: 'sizeReference' }, ui: { label: 'Size Reference', isAdvanced: true, control: {} }, defaultValue: { inputSource: 'literal', value: 'longSide' } },
		// 発生源は単一の座標とし、画素ごとに異なる位置を持つvector場の接続は受け付けない。
		// Positionは画面座標で指定し、移動量も同じ座標系で前回描画値との差分から求める。
		position: {
			dataType: { kind: 'vector' },
			ui: { label: 'Position', control: { controlType: 'xy', min: -1, max: 1, step: 0.01 } },
			canNode: false,
			defaultValue: { inputSource: 'literal', value: [0, 0] },
		},
		strength: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Strength',
				control: { controlType: 'range', min: 0, max: 2, step: 0.01 },
			},
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		// Screenは各軸の画面寸法、Isotropicは長辺を共通の距離単位とする。
		// scalarは常に長辺基準で測り、この選択によって強さの意味を変えない。
		vectorCoordinateSystem: {
			dataType: { kind: 'enum', options: ['screen', 'isotropic'] },
			ui: {
				label: 'Vector Coordinates',
				control: { labels: { screen: 'Screen', isotropic: 'Isotropic (Long Side)' } },
			},
			defaultValue: { inputSource: 'literal', value: 'screen' },
		},
		radius: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Radius',
				control: { controlType: 'range', min: 0, max: 2, step: 0.01 },
			},
			defaultValue: { inputSource: 'literal', value: 0.3 },
		},
		halfLife: {
			dataType: { kind: 'scalar' },
			ui: {
				label: 'Half-Life (ms)',
				control: { controlType: 'range', min: 1, max: 5000, step: 1 },
			},
			defaultValue: { inputSource: 'literal', value: 300 },
		},
	},
	primaryInputParameter: null,
	resolutionInputParameters: [],
	outputDefs: {
		output: { dataType: { kind: 'vector' } },
		scalar: { dataType: { kind: 'scalar' } },
	},
	primaryOutput: 'output',
});
