/** 内容の時間軸と、タイムライン上で表示・再生する区間を独立して保持する。 */
export type TimelineLayerTiming = {
	/** 内容の時刻0を配置する時刻。表示開始が0以降なら負の配置も許可する。 */
	positionMs: number;
	/** 内容先頭からのトリム量。 */
	trimStartMs: number;
	/** トリム後の表示・再生区間の長さ。 */
	trimmedDurationMs: number;
};

export function createUntrimmedTimelineLayerTiming(positionMs: number, trimmedDurationMs: number): TimelineLayerTiming {
	return { positionMs, trimStartMs: 0, trimmedDurationMs };
}

export function getTimelineLayerStart(timing: TimelineLayerTiming): number {
	return timing.positionMs + timing.trimStartMs;
}

export function getTimelineLayerEnd(timing: TimelineLayerTiming): number {
	return getTimelineLayerStart(timing) + timing.trimmedDurationMs;
}

export function isTimelineLayerVisible(timing: TimelineLayerTiming, timelineTimeMs: number): boolean {
	return getTimelineLayerStart(timing) <= timelineTimeMs && timelineTimeMs < getTimelineLayerEnd(timing);
}

/** 式・キーフレーム・素材の読み出しに使う時刻。トリムを変えても内容はずれない。 */
export function getTimelineLayerContentTime(timing: TimelineLayerTiming, timelineTimeMs: number): number {
	return timelineTimeMs - timing.positionMs;
}

/** 表示区間内の時刻。内容の評価時刻とは区別し、表示前は負の値を返す。 */
export function getTimelineLayerVisibleTime(timing: TimelineLayerTiming, timelineTimeMs: number): number {
	return timelineTimeMs - getTimelineLayerStart(timing);
}

export function isTimelineLayerTimingValid(timing: TimelineLayerTiming): boolean {
	return [timing.positionMs, timing.trimStartMs, timing.trimmedDurationMs].every(Number.isFinite)
		&& getTimelineLayerStart(timing) >= 0 && Number.isFinite(getTimelineLayerEnd(timing))
		&& timing.trimStartMs >= 0 && timing.trimmedDurationMs > 0;
}
