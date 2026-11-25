import { evaluateEasing, smoothstep, smootherstep } from '../easing.ts';
import { rawBezierEasing } from '../utility/bezier.ts';
import type { FixedFunctionCurve, FunctionCurve, FunctionCurveWrapMode, BezierAnchorPoint } from './function-curve.ts';

export function getFunctionCurveEndX(curve: FunctionCurve): number | null {
	if (curve.type !== 'bezier') return 1;
	if (curve.points.length === 0) return null;
	// 点の配列は編集順のため、配列末尾とカーブ終端が一致するとは限らない。
	return curve.points.reduce((endX, point) => Math.max(endX, point.x), -Infinity);
}

export function evaluateFunctionCurve(curve: FunctionCurve, x: number, wrapMode: FunctionCurveWrapMode): number {
	return curve.type === 'bezier'
		? evaluateBezierFunctionCurve(curve.points, x, wrapMode)
		: evaluateFixedFunctionCurve(curve, wrapFunctionCurveX(x, 0, 1, wrapMode));
}

function wrapFunctionCurveX(x: number, startX: number, endX: number, wrapMode: FunctionCurveWrapMode): number {
	const duration = endX - startX;
	switch (wrapMode) {
		case 'clamp':
			return Math.max(startX, Math.min(endX, x));
		case 'repeat': {
			// 負のXでも正の周期内へ折り返す。終端は次の周期の先頭になる。
			const offset = (x - startX) % duration;
			return startX + (offset < 0 ? offset + duration : offset);
		}
		case 'repeatMirrored': {
			const period = duration * 2;
			const offset = (x - startX) % period;
			const phase = offset < 0 ? offset + period : offset;
			return startX + (phase <= duration ? phase : period - phase);
		}
	}
}

function evaluateFixedFunctionCurve(curve: FixedFunctionCurve, x: number): number {
	switch (curve.type) {
		case 'linear': return x;
		case 'smoothstep': return smoothstep(x);
		case 'smootherstep': return smootherstep(x);
		case 'easing': return evaluateEasing(x, curve.family, curve.direction);
		case 'smoothPulse': return (1 - Math.cos(2 * Math.PI * x)) / 2;
		case 'pulse': {
			if (curve.dutyCycle === 1) return 1;
			const start = (1 - curve.dutyCycle) / 2;
			return x >= start && x < 1 - start ? 1 : 0;
		}
		case 'steps': {
			// 最終段にも幅を持たせ、ループ中にXが1へ到達しなくてもY=1を出す。
			const lastLevel = curve.levelCount - 1;
			return Math.min(lastLevel, Math.floor(x * curve.levelCount)) / lastLevel;
		}
		case 'sineWave': return x === 0 || x === 1 ? 0.5 : (1 + Math.sin(2 * Math.PI * x)) / 2;
		case 'deadZone': {
			const outerWidth = (1 - curve.deadZoneWidth) / 2;
			if (x < outerWidth) return (x / outerWidth) / 2;
			if (x > 1 - outerWidth) return 1 - ((1 - x) / outerWidth) / 2;
			return 0.5;
		}
	}
}

function evaluateBezierFunctionCurve(pointsInEditOrder: readonly BezierAnchorPoint[], x: number, wrapMode: FunctionCurveWrapMode): number {
	// 元の配列を変更せずX順に並べる。同じXでは元の順序を保ち、後のポイントを優先する。
	const points = pointsInEditOrder.toSorted((a, b) => a.x - b.x);
	if (points.length === 0) return 0;
	const first = points[0];
	const last = points[points.length - 1];
	// 1点だけの場合や全点が同じXの場合は、周期を作れないので定数として扱う。
	if (last.x === first.x) return last.y;

	x = wrapFunctionCurveX(x, first.x, last.x, wrapMode);

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
