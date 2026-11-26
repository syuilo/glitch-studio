import { evaluateFunctionCurve, getFunctionCurveEndX } from '../function-curve/function-curve-evaluator.ts';
import { isFunctionCurveXNormalized, isFunctionCurveYNormalized } from '../function-curve/function-curve.ts';
import type { FunctionCurve } from '../function-curve/function-curve.ts';
import { DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN, DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX } from './curve-animation.ts';
import type { CurveAnimation } from './curve-animation.ts';

export function evaluateCurveAnimation(curveAnimation: CurveAnimation, curve: FunctionCurve, time: number, endTime: number): number {
	// 正規化Curve Animationの1をtrimmedDurationMsに対応付ける。未指定・無効なdurationはUIの初期値と同じ1秒にする。
	const scale = isFunctionCurveXNormalized(curve)
		? (curveAnimation.trimmedDurationMs != null && Number.isFinite(curveAnimation.trimmedDurationMs) && curveAnimation.trimmedDurationMs > 0 ? curveAnimation.trimmedDurationMs : 1000)
		: 1;
	let x = time / scale;
	// 終了時刻を持たないコンテキストではstartと同じ扱いにし、InfinityによるNaNを避ける。
	if (curveAnimation.offsetMode === 'end' && Number.isFinite(endTime)) {
		const endX = getFunctionCurveEndX(curve);
		if (endX != null) x = (time - endTime) / scale + endX;
	}
	const y = evaluateFunctionCurve(curve, x, curveAnimation.wrapMode);
	if (!isFunctionCurveYNormalized(curve)) return y;
	const min = curveAnimation.yRangeMin ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MIN;
	const max = curveAnimation.yRangeMax ?? DEFAULT_CURVE_ANIMATION_Y_RANGE_MAX;
	// 正規化Yの0と1を各端点へ写す。Bézierのオーバーシュートも再生結果へ反映する。
	if (y === 0 || min === max) return min;
	if (y === 1) return max;
	return min + y * (max - min);
}
