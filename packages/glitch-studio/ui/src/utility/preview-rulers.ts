import type { PreviewCanvasRect } from './preview-transform.ts';

export type PreviewViewportSize = { width: number; height: number };
export type PreviewRulerTick = { coordinate: number; position: number; label: string };

/** 表示中のCanvasと同じ共通座標を使い、画像外も含めた可視範囲の目盛りを作る。 */
export function getPreviewRulerTicks(canvasRect: PreviewCanvasRect, viewportSize: PreviewViewportSize): { x: PreviewRulerTick[]; y: PreviewRulerTick[] } {
	const longSide = Math.max(canvasRect.width, canvasRect.height);
	if (canvasRect.width <= 0 || canvasRect.height <= 0 || viewportSize.width <= 0 || viewportSize.height <= 0) return { x: [], y: [] };
	const originX = canvasRect.left + canvasRect.width / 2;
	const originY = canvasRect.top + canvasRect.height / 2;
	const minimumX = -originX / longSide;
	const maximumX = (viewportSize.width - originX) / longSide;
	const minimumY = (originY - viewportSize.height) / longSide;
	const maximumY = originY / longSide;

	// 間隔は必ず2の累乗にする。CSS pxを基準に選び、DPRやレンダリング解像度には依存させない。
	let exponent = Math.ceil(Math.log2(64 / longSide));
	const maximumCoordinate = Math.max(Math.abs(minimumX), Math.abs(maximumX), Math.abs(minimumY), Math.abs(maximumY));
	const integerDigits = Math.max(1, Math.floor(Math.log10(maximumCoordinate)) + 1);
	// 半分刻みの値は小数部が長くなるため、拡大時にも数値を丸めず読める幅を確保する。
	// 等幅11pxの文字幅を7pxと見積もり、符号・小数点・ラベル間の余白も含める。
	while (2 ** exponent * longSide < (integerDigits + Math.max(0, -exponent) + 2) * 7 + 16) exponent++;
	const interval = 2 ** exponent;

	function ticks(minimum: number, maximum: number, origin: number, direction: number): PreviewRulerTick[] {
		const firstIndex = Math.ceil(minimum / interval);
		const lastIndex = Math.floor(maximum / interval);
		return Array.from({ length: Math.max(0, lastIndex - firstIndex + 1) }, (_, index) => {
			const coordinate = (firstIndex + index) * interval;
			return { coordinate, position: origin + direction * coordinate * longSide, label: String(coordinate) };
		});
	}

	return { x: ticks(minimumX, maximumX, originX, 1), y: ticks(minimumY, maximumY, originY, -1) };
}
