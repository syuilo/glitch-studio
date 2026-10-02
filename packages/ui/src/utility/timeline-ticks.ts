import { niceScale, insertIntermediateNumbers } from '@glitch/shared/utility/misc.ts';
import type { TimelineClipTiming } from '@glitch/shared/timeline/timing.ts';

export type TimelineClipTick = { contentTimeMs: number; sceneTimeMs: number };
export type TimelineClipTicks = { major: TimelineClipTick[]; minor: TimelineClipTick[] };

/** 表示・スナップで同じ目盛りを使い、内容時刻とScene上の位置を取り違えないようにする。 */
export function getTimelineClipTicks(clip: TimelineClipTiming, viewportStartMs: number, viewportDurationMs: number, count: number): TimelineClipTicks {
	// トリムしても内容の時間原点は変わらない。目盛り間隔はクリップ長ではなく画面の倍率で決める。
	const originMs = clip.startMs - clip.contentOffsetMs;
	const ticks = getTimelineLocalTicks(originMs, viewportStartMs, viewportDurationMs, count);
	const toTick = (contentTimeMs: number): TimelineClipTick => ({ contentTimeMs, sceneTimeMs: originMs + contentTimeMs });
	const inVisibleRange = (tick: TimelineClipTick) => tick.contentTimeMs >= clip.contentOffsetMs
		&& tick.contentTimeMs < clip.contentOffsetMs + clip.durationMs
		&& tick.sceneTimeMs >= viewportStartMs && tick.sceneTimeMs <= viewportStartMs + viewportDurationMs;
	// 先に主目盛りを絞ると、端の区間や短いクリップにある補助目盛りまで失われる。
	const minor = ticks.length === 0 ? [] : insertIntermediateNumbers(ticks).filter((_, index) => index % 2 === 1);
	return { major: ticks.map(toTick).filter(inVisibleRange), minor: minor.map(toTick).filter(inVisibleRange) };
}

/** 表示範囲を内容の時間原点へ移してから目盛りを生成する。戻り値もローカル時刻。 */
export function getTimelineLocalTicks(originMs: number, viewportStartMs: number, viewportDurationMs: number, count: number): number[] {
	if (viewportDurationMs <= 0 || ![originMs, viewportStartMs, viewportDurationMs, count].every(Number.isFinite)) return [];
	return niceScale(viewportStartMs - originMs, viewportStartMs - originMs + viewportDurationMs, count);
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
