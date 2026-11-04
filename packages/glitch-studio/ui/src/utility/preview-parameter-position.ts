import type { PreviewCanvasRect } from './preview-transform.ts';
import type { PreviewParameterPoint } from './preview-parameter-editing.ts';

// 表示用グリッドとスナップ候補を同じ定義から作り、線の追加・変更で挙動がずれないようにする。
export const previewGridLinePositions = [1 / 4, 1 / 3, 1 / 2, 2 / 3, 3 / 4];

export function previewParameterToScreen(position: PreviewParameterPoint, rect: PreviewCanvasRect): PreviewParameterPoint {
	const longSide = Math.max(rect.width, rect.height);
	return [rect.left + rect.width / 2 + position[0] * longSide, rect.top + rect.height / 2 - position[1] * longSide];
}

export function previewScreenToParameter(position: PreviewParameterPoint, rect: PreviewCanvasRect): PreviewParameterPoint {
	const longSide = Math.max(rect.width, rect.height);
	return [(position[0] - rect.left - rect.width / 2) / longSide, (rect.top + rect.height / 2 - position[1]) / longSide];
}

/** 距離はCSS pxで判定する。倍率・DPR・縦横比が変わっても吸着の操作感と等方的な単位を保つ。 */
export function snapPreviewParameterPosition(position: PreviewParameterPoint, rect: PreviewCanvasRect, showGrid: boolean, threshold = 6): PreviewParameterPoint {
	const longSide = Math.max(rect.width, rect.height);
	if (longSide <= 0) return [...position];
	const fractions = showGrid ? [0, ...previewGridLinePositions, 1] : [0, 0.5, 1];
	return position.map((component, axis) => {
		const size = axis === 0 ? rect.width : rect.height;
		let result = component;
		let nearest = threshold;
		for (const fraction of fractions) {
			const candidate = (fraction - 0.5) * size / longSide;
			const distance = Math.abs(candidate - component) * longSide;
			if (distance <= nearest) { nearest = distance; result = candidate; }
		}
		return result;
	}) as PreviewParameterPoint;
}
