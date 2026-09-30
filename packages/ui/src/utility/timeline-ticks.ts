import { niceScale, insertIntermediateNumbers } from '@glitch/shared/utility/misc.ts';
import type { TimelineLayerTiming } from '@glitch/shared/timeline/timing.ts';

export type TimelineLocalTicks = { major: number[]; minor: number[] };

/** 目盛り間隔は画面の倍率で決め、主目盛り・補助目盛りをそれぞれ表示区間で絞る。 */
export function getTimelineLayerTicks(timing: TimelineLayerTiming, viewportStartMs: number, viewportDurationMs: number, count: number): TimelineLocalTicks {
	const ticks = getTimelineLocalTicks(timing.positionMs, viewportStartMs, viewportDurationMs, count);
	const inVisibleRange = (time: number) => time >= timing.trimStartMs && time < timing.trimStartMs + timing.trimmedDurationMs;
	// 先に主目盛りを絞ると、端の区間や短いレイヤーにある補助目盛りまで失われる。
	const minor = ticks.length === 0 ? [] : insertIntermediateNumbers(ticks).filter((time, index) => index % 2 === 1 && inVisibleRange(time));
	return { major: ticks.filter(inVisibleRange), minor };
}

/** 表示範囲をレイヤーの時間軸へ移してから目盛りを生成する。戻り値もローカル時刻。 */
export function getTimelineLocalTicks(positionMs: number, viewportStartMs: number, viewportDurationMs: number, count: number): number[] {
	if (viewportDurationMs <= 0 || ![positionMs, viewportStartMs, viewportDurationMs, count].every(Number.isFinite)) return [];
	return niceScale(viewportStartMs - positionMs, viewportStartMs - positionMs + viewportDurationMs, count);
}

export function formatTimelineTimecode(timeMs: number): string {
	const ms = Math.floor(Math.abs(timeMs));
	const totalSeconds = Math.floor(ms / 1000);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	const milliseconds = ms % 1000;
	const fraction = milliseconds === 0 ? '' : `.${String(milliseconds).padStart(3, '0').replace(/0+$/, '')}`;
	return `${timeMs < 0 && ms !== 0 ? '-' : ''}${minutes}:${seconds}${fraction}`;
}
