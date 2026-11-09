/** 解析用の座標軸。画像の保存値やプレビュー露出を変更しない。EVの0はlinear 0.18。 */
export const IMAGE_VALUE_SCALES = ['srgb', 'linear', 'ev'] as const;
export type ImageValueScale = (typeof IMAGE_VALUE_SCALES)[number];

/** 選択した軸の単位での表示範囲。minimum > maximumは反転した軸を表す。 */
export type ImageValueRange = { minimum: number; maximum: number };
export const DEFAULT_IMAGE_VALUE_RANGE: Readonly<ImageValueRange> = { minimum: 0, maximum: 1 };

export function isDrawableImageValueRange(range: ImageValueRange): boolean {
	// GPUへ渡す際に同じfloat32へ丸められる範囲も、0除算を起こさないよう空表示にする。
	const minimum = Math.fround(range.minimum);
	const maximum = Math.fround(range.maximum);
	return Number.isFinite(minimum) && Number.isFinite(maximum) && Number.isFinite(Math.fround(maximum - minimum)) && minimum !== maximum;
}
