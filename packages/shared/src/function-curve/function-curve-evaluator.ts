import { rawBezierEasing } from '../utility/bezier.ts';
import type { BezierAnchorPoint, FunctionCurveWrapMode } from './function-curve.ts';

export function evaluateFunctionCurve(functionCurve: { points: readonly BezierAnchorPoint[] }, x: number, wrapMode: FunctionCurveWrapMode): number {
	// 元の配列を変更せずX順に並べる。同じXでは元の順序を保ち、後のポイントを優先する。
	const points = functionCurve.points.toSorted((a, b) => a.x - b.x);
	if (points.length === 0) return 0;
	const first = points[0];
	const last = points[points.length - 1];
	const duration = last.x - first.x;
	// 1点だけの場合や全点が同じXの場合は、周期を作れないので定数として扱う。
	if (duration === 0) return last.y;

	switch (wrapMode) {
		case 'clamp':
			x = Math.max(first.x, Math.min(last.x, x));
			break;
		case 'repeat': {
			// 負のXでも正の周期内へ折り返す。終端は次の周期の先頭になる。
			const offset = (x - first.x) % duration;
			x = first.x + (offset < 0 ? offset + duration : offset);
			break;
		}
		case 'repeatMirrored': {
			const period = duration * 2;
			const offset = (x - first.x) % period;
			const phase = offset < 0 ? offset + period : offset;
			x = first.x + (phase <= duration ? phase : period - phase);
			break;
		}
	}

	const prevPoint = points.findLast(point => point.x <= x);
	const nextPoint = points.find(point => point.x > x);
	if (prevPoint == null) return first.y;
	if (nextPoint == null || prevPoint.x === x) return prevPoint.y;
	return rawBezierEasing(
		prevPoint.x,
		prevPoint.x + prevPoint.bezierControlPointB[0],
		nextPoint.x + nextPoint.bezierControlPointA[0],
		nextPoint.x,
		prevPoint.y,
		prevPoint.y + prevPoint.bezierControlPointB[1],
		nextPoint.y + nextPoint.bezierControlPointA[1],
		nextPoint.y,
		x,
	);
}
