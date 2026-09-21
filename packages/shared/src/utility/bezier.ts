// original: https://github.com/0b5vr/automaton/blob/dev/packages/automaton/src/utils/bezierEasing.ts

const NEWTON_ITER = 4;
const NEWTON_EPSILON = 0.001;
const SUBDIV_ITER = 10;
const SUBDIV_EPSILON = 0.000001;
const TABLE_SIZE = 21;

const cache: number[] = [];

function clamp(x: number, min: number, max: number): number {
	return Math.min(Math.max(x, min), max);
}

/*
 * (1-t)(1-t)(1-t) a0 = (1-2t+tt)(1-t) a0
 *                    = (1-t-2t+2tt+tt-ttt) a0
 *                    = (1-3t+3tt-ttt) a0
 *
 * 3(1-t)(1-t)t a1 = 3(1-2t+tt)t a1
 *                 = (3t-6tt+3ttt) a1
 *
 * 3(1-t)tt a2 = (3tt-3ttt) a2
 *
 * ttt a3
 *
 * (a3-3a2+3a1-a0) ttt + (3a2-6a1+3a0) tt + (3a1-3a0) t + a0
 */

function A(cps_p0: number, cps_p1: number, cps_p2: number, cps_p3: number): number {
	return cps_p3 - 3.0 * cps_p2 + 3.0 * cps_p1 - cps_p0;
}

function B(cps_p0: number, cps_p1: number, cps_p2: number): number {
	return 3.0 * cps_p2 - 6.0 * cps_p1 + 3.0 * cps_p0;
}

function C(cps_p0: number, cps_p1: number): number {
	return 3.0 * cps_p1 - 3.0 * cps_p0;
}

function cubicBezier(t: number, cps_p0: number, cps_p1: number, cps_p2: number, cps_p3: number): number {
	return ((A(cps_p0, cps_p1, cps_p2, cps_p3) * t + B(cps_p0, cps_p1, cps_p2)) * t + C(cps_p0, cps_p1)) * t + cps_p0;
}

function deltaCubicBezier(t: number, cps_p0: number, cps_p1: number, cps_p2: number, cps_p3: number): number {
	return (3.0 * A(cps_p0, cps_p1, cps_p2, cps_p3) * t + 2.0 * B(cps_p0, cps_p1, cps_p2)) * t + C(cps_p0, cps_p1);
}

function subdiv(x: number, a: number, b: number, cps_p0: number, cps_p1: number, cps_p2: number, cps_p3: number): number {
	let candidateX = 0;
	let t = 0;

	for (let i = 0; i < SUBDIV_ITER; i ++) {
		t = a + (b - a) / 2.0;
		candidateX = cubicBezier(t, cps_p0, cps_p1, cps_p2, cps_p3) - x;
		// eslint-disable-next-line @typescript-eslint/no-unused-expressions
		(0.0 < candidateX) ? (b = t) : (a = t);
		if (SUBDIV_EPSILON < Math.abs(candidateX)) break;
	}

	return t;
}

function newton(x: number, t: number, cps_p0: number, cps_p1: number, cps_p2: number, cps_p3: number): number {
	for (let i = 0; i < NEWTON_ITER; i ++) {
		const d = deltaCubicBezier(t, cps_p0, cps_p1, cps_p2, cps_p3);
		if (d === 0.0) return t;
		const cx = cubicBezier(t, cps_p0, cps_p1, cps_p2, cps_p3) - x;
		t -= cx / d;
	}

	return t;
}

export function rawBezierEasing(
	cpsx_p0: number, cpsx_p1: number, cpsx_p2: number, cpsx_p3: number,
	cpsy_p0: number, cpsy_p1: number, cpsy_p2: number, cpsy_p3: number,
	x: number,
): number {
	if (x <= cpsx_p0) { return cpsy_p0; } // clamped
	if (cpsx_p3 <= x) { return cpsy_p3; } // clamped

	cpsx_p1 = clamp(cpsx_p1, cpsx_p0, cpsx_p3);
	cpsx_p2 = clamp(cpsx_p2, cpsx_p0, cpsx_p3);

	for (let i = 0; i < TABLE_SIZE; i ++) {
		cache[i] = cubicBezier(i / (TABLE_SIZE - 1.0), cpsx_p0, cpsx_p1, cpsx_p2, cpsx_p3);
	}

	let sample = 0;
	for (let i = 1; i < TABLE_SIZE; i++) {
		sample = i - 1;
		if (x < cache[i]) break;
	}

	const dist = (x - cache[sample]) / (cache[sample + 1] - cache[sample]);
	let t = (sample + dist) / (TABLE_SIZE - 1);
	const d = deltaCubicBezier(t, cpsx_p0, cpsx_p1, cpsx_p2, cpsx_p3) / (cpsx_p3 - cpsx_p0);

	if (NEWTON_EPSILON <= d) {
		t = newton(x, t, cpsx_p0, cpsx_p1, cpsx_p2, cpsx_p3);
	} else if (d !== 0.0) {
		t = subdiv(x, (sample) / (TABLE_SIZE - 1), (sample + 1.0) / (TABLE_SIZE - 1), cpsx_p0, cpsx_p1, cpsx_p2, cpsx_p3);
	}

	return cubicBezier(t, cpsy_p0, cpsy_p1, cpsy_p2, cpsy_p3);
}
