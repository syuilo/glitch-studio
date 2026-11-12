import type { PreviewImageAnalysisViewport } from '@gs/glitch-studio_shared/preview-image-analysis-viewport.ts';

const MINIMUM_SPAN = 1 / 100;
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

/** ポインター直下の解析位置を固定する。表示端の制約に当たった場合だけ支点をずらす。 */
export function zoomImageAnalysisViewport(viewport: PreviewImageAnalysisViewport, anchor: { x: number; y: number }, factor: number): PreviewImageAnalysisViewport {
	const width = clamp(viewport.width / factor, MINIMUM_SPAN, 1);
	const height = clamp(viewport.height / factor, MINIMUM_SPAN, 1);
	return {
		x: clamp(viewport.x + clamp(anchor.x, 0, 1) * (viewport.width - width), 0, 1 - width),
		y: clamp(viewport.y + clamp(anchor.y, 0, 1) * (viewport.height - height), 0, 1 - height),
		width,
		height,
	};
}

/** ドラッグした方向へ内容を動かす。CSS寸法から換算するためDPRには依存しない。 */
export function panImageAnalysisViewport(viewport: PreviewImageAnalysisViewport, movement: { x: number; y: number }, size: { width: number; height: number }): PreviewImageAnalysisViewport {
	if (size.width <= 0 || size.height <= 0) return { ...viewport };
	return {
		...viewport,
		x: clamp(viewport.x - movement.x / size.width * viewport.width, 0, 1 - viewport.width),
		y: clamp(viewport.y - movement.y / size.height * viewport.height, 0, 1 - viewport.height),
	};
}
