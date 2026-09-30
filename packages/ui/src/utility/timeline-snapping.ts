import { constrainTimelineMove } from './timeline-selection.ts';

export type TimelineSnapSettings = {
	enabled: boolean;
	globalTicks: boolean;
	localTicks: boolean;
};

/** 目盛り以外の候補は全体スイッチだけに従う。クリップ操作ではlocalTicksを渡さない。 */
export function getTimelineSnapCandidates(settings: TimelineSnapSettings, otherTimes: number[], globalTicks: number[], localTicks: number[] = []): number[] {
	if (!settings.enabled) return [];
	return [...new Set([
		...otherTimes,
		...(settings.globalTicks ? globalTicks : []),
		...(settings.localTicks ? localTicks : []),
	])];
}

export function getTimelineSeekPosition(timeMs: number, durationMs: number, snapTimes: number[], msPerPixel: number): { timeMs: number; snappingTime: number | null } {
	// 終端そのものは再生区間外なので候補から除外する。空のタイムラインでは0に留める。
	const result = constrainTimelineMove(timeMs, [{ time: 0, minDelta: 0, maxDelta: Math.max(0, durationMs - 1) }], snapTimes, msPerPixel);
	return { timeMs: result.delta, snappingTime: result.snappingTime };
}
