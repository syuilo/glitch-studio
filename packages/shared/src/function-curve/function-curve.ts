import type { EasingSettings } from '../easing.ts';

export type BezierAnchorPoint = {
	id: string;
	x: number;
	y: number;
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

type FunctionCurveSettings = { skew?: number | null };

export type BezierFunctionCurve = FunctionCurveSettings & {
	type: 'bezier';
	points: BezierAnchorPoint[];
	isXNormalized: boolean;
	isYNormalized: boolean;
};

export type FixedFunctionCurve = FunctionCurveSettings & (
	| { type: 'linear' }
	| { type: 'smoothstep' }
	| { type: 'smootherstep' }
	| ({ type: 'easing' } & EasingSettings)
	| { type: 'smoothPulse' }
	| { type: 'pulse'; dutyCycle: number }
	| { type: 'steps'; levelCount: number }
	| { type: 'sineWave' }
	| { type: 'deadZone'; deadZoneWidth: number }
);

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
