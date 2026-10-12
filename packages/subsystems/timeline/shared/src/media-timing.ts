import { getTimelineClipMoveBounds, getTimelineLoopCycle, getTimelineMediaMaxDurationMs, isTimelineClipTimingValid } from './timing.ts';
import type { TimelineClipPlacement } from './timing.ts';
import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';

// 極端な倍率では音声の帯域制限フィルターと映像のデコード負荷が大きくなるため、
// 操作可能な範囲をUIと保存データで共通にする。0倍のフリーズは別の時間モデルで扱う。
export const timelineMediaMinPlaybackSpeed = 0.01;
export const timelineMediaMaxPlaybackSpeed = 16;

/** 動画・音声に共通する素材の時計。素材範囲は方向によらず昇順の半開区間。 */
export type TimelineMediaSourceTiming = {
	startMs: number;
	sourceInMs: number;
	sourceOutMs: number;
	playbackRate: number;
	loop: boolean;
};

export type TimelineMediaClipTiming = TimelineClipPlacement & TimelineMediaSourceTiming;

export function createTimelineMediaClipTiming(startMs: number, durationMs: number): TimelineMediaClipTiming {
	return { startMs: Math.round(startMs), durationMs: Math.floor(durationMs), sourceInMs: 0, sourceOutMs: Math.floor(durationMs), playbackRate: 1, loop: false };
}

export function getTimelineMediaPeriod(clip: TimelineMediaSourceTiming): number {
	return (clip.sourceOutMs - clip.sourceInMs) / Math.abs(clip.playbackRate);
}

/** 素材端を越えない整数msにする。端数は素材範囲に保持し、倍率の往復で範囲を削らない。 */
export function getTimelineMediaSingleDuration(clip: TimelineMediaSourceTiming): number {
	return getTimelineMediaMaxDurationMs(clip.sourceInMs, clip.sourceOutMs, clip.playbackRate);
}

export function validateTimelineMediaClipTiming(clip: TimelineMediaClipTiming, sourceDurationMs = Infinity): void {
	const diagnostics = inspectTimelineMediaClipTiming(clip, sourceDurationMs);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectTimelineMediaClipTiming(clip: TimelineMediaClipTiming, sourceDurationMs = Infinity): ValidationDiagnostic[] {
	if (![clip.sourceInMs, clip.sourceOutMs, clip.playbackRate].every(Number.isFinite)
		|| clip.sourceInMs < 0 || clip.sourceOutMs <= clip.sourceInMs || clip.playbackRate === 0
		|| typeof clip.loop !== 'boolean') return [{ code: 'clip.media', message: 'Invalid media timing' }];
	const diagnostics = inspectPlaybackRate(clip.playbackRate);
	if (!isTimelineClipTimingValid(clip)) diagnostics.push({ code: 'clip.timing', message: 'Invalid media placement: duration must be at least 1 ms and start and duration must be safe integer milliseconds' });
	const singleDuration = getTimelineMediaSingleDuration(clip);
	if (!Number.isSafeInteger(singleDuration) || singleDuration < 1
		|| (clip.loop ? clip.durationMs <= singleDuration : clip.durationMs !== singleDuration)) diagnostics.push({ code: 'clip.duration', message: 'Invalid media duration' });
	const error = 4 * Number.EPSILON * Math.max(1, clip.sourceOutMs, sourceDurationMs);
	if (clip.sourceOutMs > sourceDurationMs + error) diagnostics.push({ code: 'clip.sourceDuration', message: 'Clip exceeds the media duration' });
	return diagnostics;
}

export function getTimelineMediaCycle(clip: TimelineMediaSourceTiming, sceneTimeMs: number): number {
	return getTimelineLoopCycle(clip.startMs, getTimelineMediaPeriod(clip), sceneTimeMs);
}

/** 逆再生の戻り値は左側極限として読む。フレームレートやPCMレートで時刻をずらさない。 */
export function getTimelineMediaSourceTime(clip: TimelineMediaSourceTiming, sceneTimeMs: number): number {
	const elapsedMs = sceneTimeMs - clip.startMs;
	const phaseMs = clip.loop ? Math.max(0, elapsedMs - getTimelineMediaCycle(clip, sceneTimeMs) * getTimelineMediaPeriod(clip)) : elapsedMs;
	return (clip.playbackRate > 0 ? clip.sourceInMs : clip.sourceOutMs) + phaseMs * clip.playbackRate;
}

export function changeTimelineMediaPlaybackRate<T extends TimelineMediaClipTiming>(clip: T, playbackRate: number): T {
	validatePlaybackRate(playbackRate);
	const next = { ...clip, playbackRate };
	const singleDuration = getTimelineMediaSingleDuration(next);
	const durationMs = clip.loop ? getTimelineMediaMaxDurationMs(0, clip.durationMs * Math.abs(clip.playbackRate / playbackRate)) : singleDuration;
	const result = { ...next, durationMs, loop: clip.loop && durationMs > singleDuration };
	validateTimelineMediaClipTiming(result);
	return result;
}

function validatePlaybackRate(playbackRate: number): void {
	const diagnostics = inspectPlaybackRate(playbackRate);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

function inspectPlaybackRate(playbackRate: number): ValidationDiagnostic[] {
	return !Number.isFinite(playbackRate) || Math.abs(playbackRate) < timelineMediaMinPlaybackSpeed || Math.abs(playbackRate) > timelineMediaMaxPlaybackSpeed
		? [{ code: 'clip.playbackRate', message: `Playback speed must be between ${timelineMediaMinPlaybackSpeed * 100}% and ${timelineMediaMaxPlaybackSpeed * 100}%` }] : [];
}

type ClipWithId = TimelineClipPlacement & { id: string };

export function getTimelineMediaTrimBounds(clips: readonly ClipWithId[], clip: TimelineMediaClipTiming & { id: string }, edge: 'start' | 'end', sourceDurationMs: number) {
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	const singleDuration = getTimelineMediaSingleDuration(clip);
	const before = clip.playbackRate > 0
		? getTimelineMediaMaxDurationMs(0, clip.sourceInMs, clip.playbackRate)
		: getTimelineMediaMaxDurationMs(clip.sourceOutMs, sourceDurationMs, clip.playbackRate);
	const after = clip.playbackRate > 0
		? getTimelineMediaMaxDurationMs(clip.sourceOutMs, sourceDurationMs, clip.playbackRate)
		: getTimelineMediaMaxDurationMs(0, clip.sourceInMs, clip.playbackRate);
	// floor(全体長 - 周期) = 全体長 + floor(-周期)。周期だけを先に整数化すると
	// 本来の端数まで延長できてしまうため、負の素材範囲にも同じ誤差補正を適用する。
	const loopExtension = clip.durationMs + getTimelineMediaMaxDurationMs(clip.sourceOutMs, clip.sourceInMs, clip.playbackRate);
	return edge === 'start'
		? { minDelta: Math.max(bounds.minDelta, -before), maxDelta: singleDuration - 1 }
		: { minDelta: 1 - singleDuration, maxDelta: Math.min(clip.loop ? loopExtension : bounds.maxDelta, after) };
}

export function trimTimelineMediaClip(clip: TimelineMediaClipTiming, edge: 'start' | 'end', deltaMs: number): TimelineMediaClipTiming {
	const next = { ...clip };
	// タイムラインの左端は「再生の先頭」。逆再生では素材の右端を削る。
	if (edge === 'start') {
		next.startMs += deltaMs;
		next.durationMs -= deltaMs;
		if (clip.playbackRate > 0) next.sourceInMs += deltaMs * clip.playbackRate;
		else next.sourceOutMs += deltaMs * clip.playbackRate;
	} else {
		if (!clip.loop) next.durationMs += deltaMs;
		if (clip.playbackRate > 0) next.sourceOutMs += deltaMs * clip.playbackRate;
		else next.sourceInMs += deltaMs * clip.playbackRate;
	}
	// 0.3 - 3 * 0.1のような誤差で、素材先頭までの正当な延長が拒否されないようにする。
	const error = 4 * Number.EPSILON * Math.max(1, clip.sourceInMs, clip.sourceOutMs, Math.abs(deltaMs * clip.playbackRate));
	if (next.sourceInMs < 0 && next.sourceInMs >= -error) next.sourceInMs = 0;
	next.loop = clip.loop && next.durationMs > getTimelineMediaSingleDuration(next);
	return next;
}

export function getTimelineMediaLoopBounds(clips: readonly ClipWithId[], clip: TimelineMediaClipTiming & { id: string }) {
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	return { minDelta: getTimelineMediaSingleDuration(clip) - clip.durationMs,
		maxDelta: Math.min(bounds.maxDelta, Number.MAX_SAFE_INTEGER - clip.startMs - clip.durationMs) };
}
