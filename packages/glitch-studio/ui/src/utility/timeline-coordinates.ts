/** 描画と範囲選択が同じ横座標を使う。配置と親要素の移動を分けて計算する。 */
export function timelineTimeToX(time: number, position: number, range: number, width: number): number {
	const pixelsPerMs = width / range;
	return time * pixelsPerMs - position * pixelsPerMs;
}

/** 丸めはスクロール前の配置に対して行う。移動のたびに全キーを再配置しないため。 */
export function timelineKeyframePosition(time: number, pixelsPerMs: number): number {
	return Math.round(time * pixelsPerMs);
}

export function timelinePointerTime(clientX: number, viewportLeft: number, position: number, pixelsPerMs: number): number {
	return position + (clientX - viewportLeft) / pixelsPerMs;
}
