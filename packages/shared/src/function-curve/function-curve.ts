export type BezierAnchorPoint = {
	id: string;
	x: number;
	y: number;
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type FunctionCurve = {
	points: BezierAnchorPoint[];
	isXNormalized: boolean;
	isYNormalized: boolean;
};

export type SharedFunctionCurve = FunctionCurve & {
	id: string;
	nameForReference: string;
};
