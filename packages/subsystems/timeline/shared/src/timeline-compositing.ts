import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/**
 * worldは親から受け継ぐ空間座標、screenは現在の合成先の画面座標。
 * 座標空間はレイヤーの静的な属性とし、式・キーフレームでは切り替えない。
 */
export type TimelineLayerCoordinateSpace = 'world' | 'screen';

/** 素材の色を重ねる代わりに、同じ合成境界の下層を切り抜く静的な設定。 */
export type TimelineMask = {
	channel: 'alpha' | 'luminance';
	inverted: boolean;
};

export function validateTimelineMask(mask: TimelineMask | null): void {
	if (mask == null) return;
	if ((mask.channel !== 'alpha' && mask.channel !== 'luminance') || typeof mask.inverted !== 'boolean') throw new Error('Invalid timeline mask');
}

export const timelineCompositingParamDefs = {
	depth: {
		dataType: { kind: 'scalar' }, ui: { label: 'Z', control: { controlType: 'range', min: -10, max: 10, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
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
		ui: { label: 'Scale', control: { controlType: 'dimension', min: -2, max: 2, step: 0.01 } },
		defaultValue: { inputSource: 'literal', value: [1, 1] }, canNode: false,
	},
	rotation: {
		dataType: { kind: 'scalar' },
		ui: { label: 'Rotation', control: { controlType: 'angle' } },
		defaultValue: { inputSource: 'literal', value: 0 }, canNode: false,
	},
	clipToFrame: {
		dataType: { kind: 'bool' }, ui: { label: 'Clip to Frame', control: {} },
		defaultValue: { inputSource: 'literal', value: false }, canNode: false,
	},
} as const satisfies Record<string, ParameterDefinition>;

const timelineMaskCompositingParamDefs = {
	...timelineCompositingParamDefs,
	opacity: { ...timelineCompositingParamDefs.opacity, ui: { ...timelineCompositingParamDefs.opacity.ui, label: 'Mask strength' } },
};

/** Bindingの保存先は変えず、Inspectorとキーフレームで強度の呼び名を揃える。 */
export function getTimelineCompositingParameterDefinitions(mask: TimelineMask | null): Record<keyof typeof timelineCompositingParamDefs, ParameterDefinition> {
	return mask == null ? timelineCompositingParamDefs : timelineMaskCompositingParamDefs;
}
