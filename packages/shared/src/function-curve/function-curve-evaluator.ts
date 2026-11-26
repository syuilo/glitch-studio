import { evaluateEasing, smoothstep, smootherstep } from '../easing.ts';
import { rawBezierEasing } from '../utility/bezier.ts';
import type { BezierFunctionCurve, FixedFunctionCurve, FunctionCurve, FunctionCurveWrapMode } from './function-curve.ts';

declare const USE_BEZIER_FUNCTION_CURVE: boolean;
declare const USE_FIXED_FUNCTION_CURVE: boolean;
declare const USE_EASING: boolean;

export function getFunctionCurveEndX(curve: FunctionCurve): number | null {
	if (curve.type !== 'bezier') return 1;
	if (curve.points.length === 0) return null;
	// 点の配列は編集順のため、配列末尾とカーブ終端が一致するとは限らない。
	return curve.points.reduce((endX, point) => Math.max(endX, point.x), -Infinity);
}

export function evaluateFunctionCurve(curve: FunctionCurve, x: number, wrapMode: FunctionCurveWrapMode): number {
	if (curve.type === 'bezier') {
		if (typeof USE_BEZIER_FUNCTION_CURVE === 'undefined' || USE_BEZIER_FUNCTION_CURVE) return evaluateBezierFunctionCurve(curve, x, wrapMode);
	} else if (typeof USE_FIXED_FUNCTION_CURVE === 'undefined' || USE_FIXED_FUNCTION_CURVE) {
		const position = wrapFunctionCurveX(x, 0, 1, wrapMode);
		return evaluateFixedFunctionCurve(curve, skewFunctionCurveX(position, 0, 1, curve.skew ?? 0));
	}
	throw new Error('Unsupported Function Curve type');
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

function skewFunctionCurveX(x: number, startX: number, endX: number, skew: number): number {
	const midpoint = (skew + 1) * 0.5;
	if (midpoint === 0.5 || x <= startX || x >= endX) return x;
	const span = endX - startX;
	const progress = (x - startX) / span;
	// 折り返し後に適用することで、Repeat Mirroredの往路と復路を同じ形に保つ。
	// 両端の座標を厳密に保ち、±1で幅が0になった側は評価しない。
	if (progress <= 0 || progress >= 1) return x;
	const remapped = progress < midpoint
		? 0.5 * (progress / midpoint)
		: 0.5 + 0.5 * ((progress - midpoint) / (1 - midpoint));
	return startX + remapped * span;
}

function evaluateFixedFunctionCurve(curve: FixedFunctionCurve, x: number): number {
	switch (curve.type) {
		case 'linear': return x;
		case 'smoothstep': return smoothstep(x);
		case 'smootherstep': return smootherstep(x);
		case 'easing':
			if (typeof USE_EASING === 'undefined' || USE_EASING) return evaluateEasing(x, curve);
			break;
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
	throw new Error('Unsupported fixed Function Curve type');
}

function evaluateBezierFunctionCurve(curve: BezierFunctionCurve, x: number, wrapMode: FunctionCurveWrapMode): number {
	// 元の配列を変更せずX順に並べる。同じXでは元の順序を保ち、後のポイントを優先する。
	const points = curve.points.toSorted((a, b) => a.x - b.x);
	if (points.length === 0) return 0;
	const first = points[0];
	const last = points[points.length - 1];
	// 1点だけの場合や全点が同じXの場合は、周期を作れないので定数として扱う。
	if (last.x === first.x) return last.y;

	const wrappedX = wrapFunctionCurveX(x, first.x, last.x, wrapMode);
	const position = skewFunctionCurveX(wrappedX, first.x, last.x, curve.skew ?? 0);

	const prevPoint = points.findLast(point => point.x <= position);
	const nextPoint = points.find(point => point.x > position);
	if (prevPoint == null) return first.y;
	if (nextPoint == null || prevPoint.x === position) return prevPoint.y;
	return rawBezierEasing(
		prevPoint.x,
		prevPoint.x + prevPoint.bezierControlPointB[0],
		nextPoint.x + nextPoint.bezierControlPointA[0],
		nextPoint.x,
		prevPoint.y,
		prevPoint.y + prevPoint.bezierControlPointB[1],
		nextPoint.y + nextPoint.bezierControlPointA[1],
		nextPoint.y,
		position,
	);
}
