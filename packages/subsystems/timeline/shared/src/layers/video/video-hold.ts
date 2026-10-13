import { getTimelineClipMoveBounds, isTimelineClipTimingValid } from '../../timing.ts';
import type { TimelineClipPlacement } from '../../timing.ts';

/** 素材の一点を表示する時計。表示長は素材長や再生倍率から独立している。 */
export type TimelineVideoHoldTiming = TimelineClipPlacement & {
	sourceTimeMs: number;
};

export function validateTimelineVideoHoldTiming(clip: TimelineVideoHoldTiming, sourceDurationMs = Infinity): void {
	if (!isTimelineClipTimingValid(clip)) throw new Error('Invalid video hold placement');
	if (!Number.isFinite(clip.sourceTimeMs) || clip.sourceTimeMs < 0 || clip.sourceTimeMs >= sourceDurationMs) {
		throw new Error('Video hold time must be within the video duration');
	}
	// 通常再生の時計が残ると、利用側によって固定表示と通常再生の解釈が異なってしまう。
	if ('sourceInMs' in clip || 'sourceOutMs' in clip || 'playbackRate' in clip || 'loop' in clip || 'contentOffsetMs' in clip) {
		throw new Error('Video hold cannot contain playback timing');
	}
}

export function getTimelineVideoHoldTrimBounds(clips: readonly (TimelineClipPlacement & { id: string })[], clip: TimelineVideoHoldTiming & { id: string }, edge: 'start' | 'end') {
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	return edge === 'start'
		? { minDelta: bounds.minDelta, maxDelta: clip.durationMs - 1 }
		: { minDelta: 1 - clip.durationMs, maxDelta: Math.min(bounds.maxDelta, Number.MAX_SAFE_INTEGER - clip.startMs - clip.durationMs) };
}

export function trimTimelineVideoHold<T extends TimelineVideoHoldTiming>(clip: T, edge: 'start' | 'end', deltaMs: number): T {
	// 左端を動かしても素材の固定地点は動かさない。左右とも表示区間だけを編集する。
	return edge === 'start'
		? { ...clip, startMs: clip.startMs + deltaMs, durationMs: clip.durationMs - deltaMs }
		: { ...clip, durationMs: clip.durationMs + deltaMs };
}
