import { getTimelineClipMoveBounds, getTimelineClipTrimBounds, getTimelineMediaMaxDurationMs } from '../../timing.ts';
import type { TimelineClipTiming } from '../../timing.ts';

export type TimelineVideoClipTiming = TimelineClipTiming & {
	/** nullは通常再生。ループ時は素材のトリム範囲の長さで、表示の全体長とは独立する。 */
	loopDurationMs: number | null;
};

export function validateTimelineVideoClipTiming(clip: TimelineVideoClipTiming): void {
	if (clip.loopDurationMs !== null && (!Number.isSafeInteger(clip.loopDurationMs) || clip.loopDurationMs < 1 || clip.loopDurationMs > clip.durationMs)) {
		throw new Error('Invalid video loop duration');
	}
}

export function getTimelineVideoSourceDuration(clip: TimelineVideoClipTiming): number {
	return clip.loopDurationMs ?? clip.durationMs;
}

export function getTimelineVideoSourceTime(clip: TimelineVideoClipTiming, sceneTimeMs: number): number {
	const elapsedMs = sceneTimeMs - clip.startMs;
	return clip.contentOffsetMs + (clip.loopDurationMs === null ? elapsedMs : elapsedMs % clip.loopDurationMs);
}

type ClipWithId = TimelineClipTiming & { id: string };

export function getTimelineVideoTrimBounds(clips: readonly ClipWithId[], clip: TimelineVideoClipTiming & { id: string }, edge: 'start' | 'end', sourceDurationMs: number) {
	if (clip.loopDurationMs === null) return getTimelineClipTrimBounds(clips, clip.id, edge, true, sourceDurationMs);
	const period = clip.loopDurationMs;
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	return edge === 'start'
		? { minDelta: Math.ceil(Math.max(bounds.minDelta, -clip.contentOffsetMs)), maxDelta: period - 1 }
		: { minDelta: 1 - period, maxDelta: Math.min(clip.durationMs, getTimelineMediaMaxDurationMs(clip.contentOffsetMs, sourceDurationMs)) - period };
}

export function trimTimelineVideoClip(clip: TimelineVideoClipTiming, edge: 'start' | 'end', deltaMs: number): TimelineVideoClipTiming {
	// 左トリムは素材開始と配置開始を同量進め、素材終端と全体終端を固定する。
	// 右トリムはループ中だけ周期を変え、他の素材と合わせた全体終端を動かさない。
	if (edge === 'start') return {
		startMs: clip.startMs + deltaMs, durationMs: clip.durationMs - deltaMs, contentOffsetMs: clip.contentOffsetMs + deltaMs,
		loopDurationMs: clip.loopDurationMs === null ? null : clip.loopDurationMs - deltaMs,
	};
	return {
		startMs: clip.startMs, contentOffsetMs: clip.contentOffsetMs,
		durationMs: clip.loopDurationMs === null ? clip.durationMs + deltaMs : clip.durationMs,
		loopDurationMs: clip.loopDurationMs === null || clip.loopDurationMs + deltaMs === clip.durationMs ? null : clip.loopDurationMs + deltaMs,
	};
}

export function getTimelineVideoLoopBounds(clips: readonly ClipWithId[], clip: TimelineVideoClipTiming & { id: string }) {
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	return {
		minDelta: getTimelineVideoSourceDuration(clip) - clip.durationMs,
		maxDelta: Math.min(bounds.maxDelta, Number.MAX_SAFE_INTEGER - clip.startMs - clip.durationMs),
	};
}
