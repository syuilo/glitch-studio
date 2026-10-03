export type BezierAnchorPoint = {
	id: string;
	x: number; // 時間(=Time)軸
	y: number; // 値(=Value)軸
	bezierControlPointA: [number, number];
	bezierControlPointB: [number, number];
};

export type AutomationGraphData = {
	points: BezierAnchorPoint[];
	isNormalized: boolean; // X軸が0~1に正規化されているかどうか。falseの場合はX軸単位がmsであるとみなす
};

export type AutomationGraph = AutomationGraphData & { id: string; name: string };

export type AutomationGraphWrapMode = 'clamp' | 'repeat' | 'repeatMirrored';

export type AutomationGraphPlaybackOptions = {
	trimmedDurationMs: number | null; // isNormalizedの場合のみ使用。nullの場合は1000ms。
	offsetMode: 'start' | 'end';
	wrapMode: AutomationGraphWrapMode;
};
