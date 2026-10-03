import { niceScale } from '@gs/shared/utility/misc.ts';
import type { TimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';

export type TimelineTickMode = 'legacy' | 'binary' | 'decimal125';
export type TimelineTickSubdivisions = { halves: boolean; thirds: boolean };
export type TimelineClipTick = { contentTimeMs: number; sceneTimeMs: number };
export type TimelineClipTicks = { major: TimelineClipTick[]; minor: TimelineClipTick[] };

/** 全体・ローカルとも同じ倍率で同じ間隔を選び、原点からの整数倍に目盛りを置く。 */
export function getTimelineTicks(startMs: number, durationMs: number, count: number, mode: TimelineTickMode = 'legacy'): number[] {
	if (durationMs <= 0 || ![startMs, durationMs, count].every(Number.isFinite)) return [];
	if (mode === 'legacy') return niceScale(startMs, startMs + durationMs, count);

	const targetStepMs = durationMs / Math.max(1, count - 1);
	let stepMs: number;
	if (mode === 'binary') {
		// msの2の累乗では1秒を基準に二分割できないため、秒へ換算してから間隔を選ぶ。
		stepMs = 1000 * 2 ** Math.floor(Math.log2(targetStepMs / 1000));
	} else {
		const magnitude = 10 ** Math.floor(Math.log10(targetStepMs));
		const normalizedStep = targetStepMs / magnitude;
		stepMs = (normalizedStep >= 5 ? 5 : normalizedStep >= 2 ? 2 : 1) * magnitude;
	}

	// 範囲の外側まで含め、端にある補助目盛りも後から生成できるようにする。
	// 加算を繰り返さずインデックスから求め、浮動小数点の誤差が累積するのを防ぐ。
	const firstIndex = Math.floor(startMs / stepMs);
	const lastIndex = Math.ceil((startMs + durationMs) / stepMs);
	return Array.from({ length: lastIndex - firstIndex + 1 }, (_, index) => (firstIndex + index) * stepMs);
}

/** 主目盛り間の補助目盛りを生成し、表示とスナップで同じ位置・有効設定を使う。 */
export function getTimelineMinorTicks(majorTicks: readonly number[], subdivisions: TimelineTickSubdivisions): number[] {
	const minorTicks: number[] = [];
	for (let index = 0; index < majorTicks.length - 1; index++) {
		const start = majorTicks[index];
		const interval = majorTicks[index + 1] - start;
		// 1/3・2/3は主目盛り間を三分割する。1/2の有効・無効で位置が変わらないようにする。
		// 小数msを保ち、Scene上の位置を解決した後、スナップ処理だけで整数msに丸める。
		if (subdivisions.thirds) minorTicks.push(start + interval / 3);
		if (subdivisions.halves) minorTicks.push(start + interval / 2);
		if (subdivisions.thirds) minorTicks.push(start + interval * 2 / 3);
	}
	return minorTicks;
}

/** 表示・スナップで同じ目盛りを使い、内容時刻とScene上の位置を取り違えないようにする。 */
export function getTimelineClipTicks(clip: TimelineClipTiming, viewportStartMs: number, viewportDurationMs: number, count: number, mode: TimelineTickMode = 'legacy', subdivisions: TimelineTickSubdivisions = { halves: true, thirds: false }): TimelineClipTicks {
	// トリムしても内容の時間原点は変わらない。目盛り間隔はクリップ長ではなく画面の倍率で決める。
	const originMs = clip.startMs - clip.contentOffsetMs;
	const ticks = getTimelineLocalTicks(originMs, viewportStartMs, viewportDurationMs, count, mode);
	const toTick = (contentTimeMs: number): TimelineClipTick => ({ contentTimeMs, sceneTimeMs: originMs + contentTimeMs });
	const inVisibleRange = (tick: TimelineClipTick) => tick.contentTimeMs >= clip.contentOffsetMs
		&& tick.contentTimeMs < clip.contentOffsetMs + clip.durationMs
		&& tick.sceneTimeMs >= viewportStartMs && tick.sceneTimeMs <= viewportStartMs + viewportDurationMs;
	// 先に主目盛りを絞ると、端の区間や短いクリップにある補助目盛りまで失われる。
	const minor = getTimelineMinorTicks(ticks, subdivisions);
	return { major: ticks.map(toTick).filter(inVisibleRange), minor: minor.map(toTick).filter(inVisibleRange) };
}

/** 表示範囲を内容の時間原点へ移してから目盛りを生成する。戻り値もローカル時刻。 */
export function getTimelineLocalTicks(originMs: number, viewportStartMs: number, viewportDurationMs: number, count: number, mode: TimelineTickMode = 'legacy'): number[] {
	if (viewportDurationMs <= 0 || ![originMs, viewportStartMs, viewportDurationMs, count].every(Number.isFinite)) return [];
	return getTimelineTicks(viewportStartMs - originMs, viewportDurationMs, count, mode);
}

export function formatTimelineTimecode(timeMs: number): string {
	// 二分割の目盛りは62.5msなどにもなるため、表示時には整数msへ切り捨てない。
	// 秒の小数点以下9桁までで浮動小数点の演算誤差を除き、不要な末尾の0を省く。
	const [wholeSeconds, fractionalSeconds] = (Math.abs(timeMs) / 1000).toFixed(9).split('.');
	const totalSeconds = Number(wholeSeconds);
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = String(totalSeconds % 60).padStart(2, '0');
	const fractionDigits = fractionalSeconds.replace(/0+$/, '');
	const fraction = fractionDigits === '' ? '' : `.${fractionDigits}`;
	return `${timeMs < 0 && (totalSeconds !== 0 || fractionDigits !== '') ? '-' : ''}${minutes}:${seconds}${fraction}`;
}
