/** 描画と範囲選択が同じ横座標を使う。キーのピクセル丸めは呼び出し側で行う。 */
export function timelineTimeToX(time: number, position: number, range: number, width: number): number {
	return (time - position) / range * width;
}
