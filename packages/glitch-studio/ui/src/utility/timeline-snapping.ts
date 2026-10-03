import { constrainTimelineMove } from './timeline-selection.ts';
import type { TimelineMovePoint } from './timeline-selection.ts';
import type { TimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';

export type TimelineSnapSettings = {
	enabled: boolean;
	globalTicks: boolean;
	localTicks: boolean;
	seekBar: boolean;
};

export type TimelineClipSnapSettings = { start: boolean; end: boolean };

/** 移動では両端、トリムでは操作中の端だけを吸着元にする。 */
export function getTimelineClipSnapPoints(clip: TimelineClipTiming, bounds: { minDelta: number; maxDelta: number }, settings: TimelineClipSnapSettings, edge?: 'start' | 'end'): TimelineMovePoint[] {
	const edges = edge == null ? ['start', 'end'] as const : [edge];
	// 無効な端も移動制約の計算には残し、吸着候補だけを空にする。
	// 両端をオフにしても移動でき、複数移動でも全クリップの衝突制限を守れる。
	return edges.map(sourceEdge => ({
		time: sourceEdge === 'start' ? clip.startMs : clip.startMs + clip.durationMs,
		...bounds,
		snapTimes: settings[sourceEdge] ? undefined : [],
	}));
}

/** クリップ操作ではlocalTicksを渡さない。シーク操作では自身への吸着を避けるためseekBarTimeMsを渡さない。 */
export function getTimelineSnapCandidates(settings: TimelineSnapSettings, otherTimes: number[], globalTicks: number[], localTicks: number[] = [], seekBarTimeMs?: number): number[] {
	if (!settings.enabled) return [];
	return [...new Set([
		...otherTimes,
		...(settings.seekBar && seekBarTimeMs != null ? [seekBarTimeMs] : []),
		...(settings.globalTicks ? globalTicks : []),
		...(settings.localTicks ? localTicks : []),
	])];
}

export function getTimelineSeekPosition(timeMs: number, durationMs: number, snapTimes: number[], msPerPixel: number): { timeMs: number; snappingTime: number | null } {
	// 終端そのものは再生区間外なので候補から除外する。空のタイムラインでは0に留める。
	const result = constrainTimelineMove(timeMs, [{ time: 0, minDelta: 0, maxDelta: Math.max(0, durationMs - 1) }], snapTimes, msPerPixel);
	return { timeMs: result.delta, snappingTime: result.snappingTime };
}
