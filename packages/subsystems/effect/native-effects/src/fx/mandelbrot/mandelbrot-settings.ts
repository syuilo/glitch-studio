export const MANDELBROT_SPAN_AT_ZOOM_ONE = 4;
export const MANDELBROT_MINIMUM_ZOOM = 0.001;
export const MANDELBROT_MAXIMUM_ZOOM = 1e300;
export const MANDELBROT_MAXIMUM_ITERATIONS = 65536;

export type MandelbrotReferenceRequest = {
	center: readonly [string, string];
	centerOffset: readonly [number, number];
	precisionBits: number;
	maximumIterations: number;
	bailoutRadius: number;
	usePerturbation: boolean;
};

/** 描画・基準軌道・計算量ヒントの反復数を揃え、上限変更時の過小評価を防ぐ。 */
export function getMandelbrotIterationCount(maximumIterations: number): number {
	return Math.min(MANDELBROT_MAXIMUM_ITERATIONS, Math.max(1, Math.floor(maximumIterations)));
}

export function getMandelbrotSettings(view: { center: readonly [number, number]; zoom: number }, maximumIterations: number, bailoutRadius: number, longSide: number) {
	if (![...view.center, view.zoom, maximumIterations, bailoutRadius].every(Number.isFinite)) {
		throw new Error('Mandelbrot view, iteration count and bailout radius must be finite.');
	}
	const zoom = Math.min(MANDELBROT_MAXIMUM_ZOOM, Math.max(MANDELBROT_MINIMUM_ZOOM, view.zoom));
	const iterations = getMandelbrotIterationCount(maximumIterations);
	const complexScale = MANDELBROT_SPAN_AT_ZOOM_ONE / zoom;
	// 画素間隔を表す桁に加えて、反復による誤差の増幅用の桁を確保する。
	// 32bit単位に丸め、ホイール操作で同じ精度範囲にいる間は基準軌道を再利用する。
	const precisionBits = Math.ceil(Math.max(128, Math.log2(zoom) + Math.log2(longSide) + Math.log2(iterations) + 64) / 32) * 32;
	return {
		zoom,
		maximumIterations: iterations,
		bailoutRadius: Math.min(1e12, Math.max(2, bailoutRadius)),
		complexScale,
		precisionBits,
		// 広い表示範囲では通常の直接反復を使い、差分の精度が必要な領域から切り替える。
		usePerturbation: zoom >= 64,
	};
}
