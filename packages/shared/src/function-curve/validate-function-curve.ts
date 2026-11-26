import { EASING_DIRECTIONS, EASING_FAMILIES } from '../easing.ts';
import type { FunctionCurve } from './function-curve.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isUnitInterval(value: unknown): boolean {
	return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isControlPoint(value: unknown): boolean {
	return Array.isArray(value) && value.length === 2 && isFiniteNumber(value[0]) && isFiniteNumber(value[1]);
}

function isFunctionCurve(value: unknown): boolean {
	if (!isRecord(value)) return false;
	switch (value.type) {
		case 'linear': case 'smoothstep': case 'smootherstep': case 'smoothPulse': case 'sineWave': return true;
		case 'pulse': return isUnitInterval(value.dutyCycle);
		case 'deadZone': return isUnitInterval(value.deadZoneWidth);
		case 'steps': return isFiniteNumber(value.levelCount) && Number.isSafeInteger(value.levelCount) && value.levelCount >= 2;
		case 'easing': {
			if (!EASING_DIRECTIONS.some(direction => direction === value.direction)) return false;
			if (value.family === 'back') return value.overshootCoefficient == null || (isFiniteNumber(value.overshootCoefficient) && value.overshootCoefficient >= 0);
			if (value.family === 'elastic') return value.period == null || (isFiniteNumber(value.period) && value.period > 0);
			return EASING_FAMILIES.some(family => family === value.family);
		}
		case 'bezier': {
			if (typeof value.isXNormalized !== 'boolean' || typeof value.isYNormalized !== 'boolean' || !Array.isArray(value.points)) return false;
			const pointIds = new Set<string>();
			for (const point of value.points as unknown[]) {
				if (!isRecord(point) || typeof point.id !== 'string' || point.id.length === 0 || pointIds.has(point.id)
					|| !isFiniteNumber(point.x) || !isFiniteNumber(point.y)
					|| !isControlPoint(point.bezierControlPointA) || !isControlPoint(point.bezierControlPointB)) return false;
				pointIds.add(point.id);
			}
			return true;
		}
		default: return false;
	}
}

export function validateFunctionCurve(value: unknown): asserts value is FunctionCurve {
	if (!isFunctionCurve(value)) throw new Error('Invalid Function Curve value');
}
