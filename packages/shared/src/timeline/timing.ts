/** Scene上の表示区間と、素材・モジュールの内容時刻を独立して保持する。 */
export type TimelineClipTiming = {
	/** Scene上の配置と長さは安全な整数ミリ秒。 */
	startMs: number;
	durationMs: number;
	/** 素材のフレーム・サンプル位置を失わないよう、小数ミリ秒を保持する。 */
	contentOffsetMs: number;
};

export function createTimelineClipTiming(startMs: number, durationMs: number): TimelineClipTiming {
	// 開始は最寄りのmsへ配置する。長さは素材や空き区間を超えない方向へ丸める。
	return { startMs: Math.round(startMs), durationMs: Math.floor(durationMs), contentOffsetMs: 0 };
}

export function getTimelineClipEnd(timing: TimelineClipTiming): number {
	return timing.startMs + timing.durationMs;
}

export function isTimelineClipActive(timing: TimelineClipTiming, sceneTimeMs: number): boolean {
	return timing.startMs <= sceneTimeMs && sceneTimeMs < getTimelineClipEnd(timing);
}

export function getTimelineClipContentTime(timing: TimelineClipTiming, sceneTimeMs: number): number {
	// 先にScene上の差を求め、大きな開始時刻への加算で素材位置の小数精度を失わないようにする。
	return timing.contentOffsetMs + (sceneTimeMs - timing.startMs);
}

export function isTimelineClipTimingValid(timing: TimelineClipTiming): boolean {
	return [timing.startMs, timing.durationMs, getTimelineClipEnd(timing)].every(Number.isSafeInteger)
		&& [timing.contentOffsetMs, timing.contentOffsetMs + timing.durationMs].every(Number.isFinite)
		&& timing.startMs >= 0 && timing.durationMs > 0 && timing.contentOffsetMs >= 0;
}

/** 素材の残り時間に収まる整数msの長さ。表示区間の衝突判定には使わない。 */
export function getTimelineMediaMaxDurationMs(contentOffsetMs: number, sourceDurationMs: number): number {
	if (sourceDurationMs === Infinity) return Infinity;
	const remainingMs = sourceDurationMs - contentOffsetMs;
	const nearestMs = Math.round(remainingMs);
	// 小数の内容オフセットを左トリムで進めた際、加減算の誤差で残り時間が
	// 整数の直前になることがある。その誤差だけを吸収し、丸々1ms短くなるのを防ぐ。
	// 通常の小数部分は切り捨て、トリム制限と保存時の素材長検証で同じ上限を使う。
	const roundingErrorMs = 4 * Number.EPSILON * Math.max(1, Math.abs(sourceDurationMs), Math.abs(contentOffsetMs));
	return Math.abs(remainingMs - nearestMs) <= roundingErrorMs ? nearestMs : Math.floor(remainingMs);
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
	if (!Number.isSafeInteger(startMs) || startMs < 0 || clips.some(clip => isTimelineClipActive(clip, startMs))) return 0;
	const nextStart = clips.reduce((next, clip) => clip.startMs > startMs ? Math.min(next, clip.startMs) : next, Infinity);
	return Math.max(0, Math.floor(Math.min(requestedDurationMs, nextStart - startMs, Number.MAX_SAFE_INTEGER - startMs)));
}

/** UIとコマンドで同じ制限を使う。生成系は左への延長を行わず、Undoだけで元の区間に戻す。 */
export function getTimelineClipTrimBounds(clips: readonly (TimelineClipTiming & { id: string })[], clipId: string, edge: 'start' | 'end', canExtendStart: boolean, sourceDurationMs = Infinity): { minDelta: number; maxDelta: number } {
	const clip = clips.find(clip => clip.id === clipId);
	if (!clip) throw new Error('Timeline clip not found');
	const bounds = getTimelineClipMoveBounds(clips, new Set([clipId]), clipId);
	// 内容オフセットと素材長は小数でも、実際に適用できる移動量は整数msに限る。
	// 下限は切り上げ、上限は切り捨てることで内容時刻0や素材終端を越えない。
	return edge === 'start'
		? { minDelta: canExtendStart ? Math.ceil(Math.max(bounds.minDelta, -clip.contentOffsetMs)) : 0, maxDelta: clip.durationMs - 1 }
		: { minDelta: 1 - clip.durationMs, maxDelta: Math.min(bounds.maxDelta, getTimelineMediaMaxDurationMs(clip.contentOffsetMs, sourceDurationMs) - clip.durationMs) };
}
