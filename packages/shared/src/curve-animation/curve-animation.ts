import type { FunctionCurve } from '../function-curve/function-curve.ts';

export type CurveAnimation = {
	curveBinding: { source: 'inline'; curve: FunctionCurve } | { source: 'reference'; curveId: string | null };
	trimmedDurationMs: number | null; // Function CurveのX軸が正規化されている場合の再生時間(ms)
	yRangeMin: number | null; // Function CurveのY軸が正規化されている場合の最小値
	yRangeMax: number | null; // Function CurveのY軸が正規化されている場合の最大値
	offsetMode: 'start' | 'end';
	wrapMode: 'clamp' | 'repeat' | 'repeatMirrored';
};
