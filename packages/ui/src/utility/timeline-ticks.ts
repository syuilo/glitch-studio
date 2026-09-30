import { niceScale } from '@glitch/shared/utility/misc.ts';

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
