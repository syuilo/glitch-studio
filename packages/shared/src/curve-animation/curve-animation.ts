export type BezierAnchorPoint = {
	id: string;
	x: number; // 時間(=Time)軸
	y: number; // 値(=Value)軸
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type CurveAnimationData = {
	points: BezierAnchorPoint[];
	isNormalized: boolean; // X軸が0~1に正規化されているかどうか。falseの場合はX軸単位がmsであるとみなす
};

export type CurveAnimation = CurveAnimationData & { id: string; nameForReference: string };

export type CurveAnimationWrapMode = 'clamp' | 'repeat' | 'repeatMirrored';

export type CurveAnimationPlaybackOptions = {
	trimmedDurationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: CurveAnimationWrapMode;
};
