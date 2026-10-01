import type { ParameterDefinition } from '../parameter.ts';

export const timelineCompositingParamDefs = {
	blendMode: {
		dataType: { kind: 'blendMode' },
		ui: { label: 'Blend mode', control: {} },
		defaultValue: { inputSource: 'literal', value: 'normal' },
	},
	opacity: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Opacity', control: { controlType: 'range', min: 0, max: 1, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 1 }, canNode: false,
	},
	// レイヤーの種類によらず、出力全体を画面へ収めてからtransformを適用する。
	fitMode: {
		dataType: { kind: 'fitMode' },
		ui: { label: 'Fit', control: {} },
		defaultValue: { inputSource: 'literal', value: 'contain' },
	},
	// Positionは移動量ではなく、素材内のOriginを配置する画面上の位置。
	position: {
		dataType: { kind: 'vector' },
		ui: { label: 'Position', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	// 透明な余白を含む入力全体の座標。中央が[0, 0]、左下が[-1, -1]、右上が[1, 1]。
	// 素材の外側にも支点を指定できるよう、操作範囲を[-2, 2]にする。
	origin: {
		dataType: { kind: 'vector' },
		ui: { label: 'Origin', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [0, 0] }, canNode: false,
	},
	scale: {
		dataType: { kind: 'vector' },
		ui: { label: 'Scale', control: { controlType: 'xy', min: -2, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false,
	},
	rotation: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Rotation', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;
