/** Scene上の表示区間と、素材・モジュールの内容時刻を独立して保持する。 */
export type TimelineClipTiming = {
	startMs: number;
	durationMs: number;
	contentOffsetMs: number;
};

export function createTimelineClipTiming(startMs: number, durationMs: number): TimelineClipTiming {
	return { startMs, durationMs, contentOffsetMs: 0 };
}

export function getTimelineClipEnd(timing: TimelineClipTiming): number {
	return timing.startMs + timing.durationMs;
}

export function isTimelineClipActive(timing: TimelineClipTiming, sceneTimeMs: number): boolean {
	return timing.startMs <= sceneTimeMs && sceneTimeMs < getTimelineClipEnd(timing);
}

export function getTimelineClipContentTime(timing: TimelineClipTiming, sceneTimeMs: number): number {
	return timing.contentOffsetMs + sceneTimeMs - timing.startMs;
}

export function isTimelineClipTimingValid(timing: TimelineClipTiming): boolean {
	return [timing.startMs, timing.durationMs, timing.contentOffsetMs, getTimelineClipEnd(timing), timing.contentOffsetMs + timing.durationMs].every(Number.isFinite)
		&& timing.startMs >= 0 && timing.durationMs > 0 && timing.contentOffsetMs >= 0;
}

/** 境界の接触は許可する。素材の未使用部分は衝突判定に含めない。 */
export function validateTimelineClips(clips: readonly (TimelineClipTiming & { id: string })[]): void {
	if (new Set(clips.map(clip => clip.id)).size !== clips.length) throw new Error('Duplicate clip ID in layer');
	const sorted = clips.toSorted((a, b) => a.startMs - b.startMs);
	for (let index = 0; index < sorted.length; index++) {
		if (!isTimelineClipTimingValid(sorted[index])) throw new Error('Invalid clip timing');
		if (index > 0 && getTimelineClipEnd(sorted[index - 1]) > sorted[index].startMs) throw new Error('Overlapping clips in layer');
	}
}

/** 選択中のクリップ同士は同量だけ移動するため、非選択の隣接区間だけで制限する。 */
export function getTimelineClipMoveBounds(clips: readonly (TimelineClipTiming & { id: string })[], selectedIds: ReadonlySet<string>, clipId: string): { minDelta: number; maxDelta: number } {
	const sorted = clips.toSorted((a, b) => a.startMs - b.startMs);
	const index = sorted.findIndex(clip => clip.id === clipId);
	if (index < 0) throw new Error('Timeline clip not found');
	const clip = sorted[index];
	const previous = sorted.slice(0, index).findLast(clip => !selectedIds.has(clip.id));
	const next = sorted.slice(index + 1).find(clip => !selectedIds.has(clip.id));
	return {
		minDelta: (previous ? getTimelineClipEnd(previous) : 0) - clip.startMs,
		maxDelta: (next?.startMs ?? Infinity) - getTimelineClipEnd(clip),
	};
}

/** 追加場所が既存クリップ内なら追加しない。次の開始位置までに必ず収める。 */
export function getTimelineClipInsertionDuration(clips: readonly TimelineClipTiming[], startMs: number, requestedDurationMs = 5000): number {
	if (!Number.isFinite(startMs) || startMs < 0 || clips.some(clip => isTimelineClipActive(clip, startMs))) return 0;
	const nextStart = clips.reduce((next, clip) => clip.startMs > startMs ? Math.min(next, clip.startMs) : next, Infinity);
	return Math.max(0, Math.min(requestedDurationMs, nextStart - startMs));
}

/** UIとコマンドで同じ制限を使う。生成系は左への延長を行わず、Undoだけで元の区間に戻す。 */
export function getTimelineClipTrimBounds(clips: readonly (TimelineClipTiming & { id: string })[], clipId: string, edge: 'start' | 'end', canExtendStart: boolean, sourceDurationMs = Infinity): { minDelta: number; maxDelta: number } {
	const clip = clips.find(clip => clip.id === clipId);
	if (!clip) throw new Error('Timeline clip not found');
	const bounds = getTimelineClipMoveBounds(clips, new Set([clipId]), clipId);
	// 保存形式は任意の正の長さを許可する。通常の操作では1msを下限とし、
	// それより短い既存クリップを編集しただけで勝手に伸ばさない。
	const minimumDurationMs = Math.min(1, clip.durationMs);
	return edge === 'start'
		? { minDelta: canExtendStart ? Math.max(bounds.minDelta, -clip.contentOffsetMs) : 0, maxDelta: clip.durationMs - minimumDurationMs }
		: { minDelta: minimumDurationMs - clip.durationMs, maxDelta: Math.min(bounds.maxDelta, sourceDurationMs - clip.contentOffsetMs - clip.durationMs) };
}
