import type { FunctionCurve, FunctionCurveWrapMode } from '../function-curve/function-curve.ts';

export const DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN = 0;
export const DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX = 1;

export type CurveAnimation = {
	curveBinding: { source: 'inline'; curve: FunctionCurve } | { source: 'reference'; curveId: string | null };
	trimmedDurationMs: number | null; // Function CurveのX軸が正規化されている場合の再生時間(ms)
	yRangeMin: number | null; // Function CurveのY軸が正規化されている場合の最小値
	yRangeMax: number | null; // Function CurveのY軸が正規化されている場合の最大値
	offsetMode: 'start' | 'end';
	wrapMode: FunctionCurveWrapMode;
};

export function isValidCurveAnimationYRange({ yRangeMin, yRangeMax }: Pick<CurveAnimation, 'yRangeMin' | 'yRangeMax'>): boolean {
	const min = yRangeMin ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN;
	const max = yRangeMax ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX;
	return Number.isFinite(min) && Number.isFinite(max) && min <= max;
}
