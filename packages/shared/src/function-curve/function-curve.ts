import type { EasingFamily, EasingDirection } from '../easing.ts';

export type BezierAnchorPoint = {
	id: string;
	x: number;
	y: number;
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type BezierFunctionCurve = {
	type: 'bezier';
	points: BezierAnchorPoint[];
	isXNormalized: boolean;
	isYNormalized: boolean;
};

export type FixedFunctionCurve =
	| { type: 'linear' }
	| { type: 'smoothstep' }
	| { type: 'smootherstep' }
	| { type: 'easing'; family: EasingFamily; direction: EasingDirection }
	| { type: 'smoothPulse' }
	| { type: 'pulse'; dutyCycle: number }
	| { type: 'steps'; levelCount: number }
	| { type: 'sineWave' }
	| { type: 'deadZone'; deadZoneWidth: number };

export type FunctionCurve = BezierFunctionCurve | FixedFunctionCurve;

export function isFunctionCurveXNormalized(curve: FunctionCurve): boolean {
	return curve.type !== 'bezier' || curve.isXNormalized;
}

export function isFunctionCurveYNormalized(curve: FunctionCurve): boolean {
	return curve.type !== 'bezier' || curve.isYNormalized;
}

export type SharedFunctionCurve = FunctionCurve & {
	id: string;
	nameForReference: string;
};

export type FunctionCurveWrapMode = 'clamp' | 'repeat' | 'repeatMirrored';
