import type { FunctionCurve } from '../function-curve/function-curve.ts';

export const FUNCTION_CURVE_KINDS = {
	linear: 0, smoothstep: 1, smootherstep: 2, easing: 3, smoothPulse: 4,
	pulse: 5, steps: 6, sineWave: 7, deadZone: 8, bezier: 9,
} as const satisfies Record<FunctionCurve['type'], number>;
