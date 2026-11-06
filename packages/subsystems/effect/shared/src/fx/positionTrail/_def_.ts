import { defineEffect } from '../../effect-definition.ts';

export default defineEffect({
	id: 'positionTrail',
	displayName: 'Position Trail',
	description: {
		'ja-JP': '位置の移動から、時間とともに薄れる動きのベクトル場と軌跡のスカラー場を生成します。',
		'en-US': 'Generates a motion vector field and a scalar trail from position changes, both fading over time.',
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
			ui: { label: 'Position', control: { controlType: 'xy', min: -0.5, max: 0.5, step: 0.01 } },
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
