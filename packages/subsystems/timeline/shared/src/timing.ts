import type { ValidationDiagnostic } from '@gs/shared/validation/diagnostic.ts';

/** Scene上の表示区間と、素材・モジュールの内容時刻を独立して保持する。 */
export type TimelineClipPlacement = {
	/** Scene上の配置と長さは安全な整数ミリ秒。 */
	startMs: number;
	durationMs: number;
};

export type TimelineClipTiming = TimelineClipPlacement & {
	/** 素材のフレーム・サンプル位置を失わないよう、小数ミリ秒を保持する。 */
	contentOffsetMs: number;
};

export function createTimelineClipTiming(startMs: number, durationMs: number): TimelineClipTiming {
	// 開始は最寄りのmsへ配置する。長さは素材や空き区間を超えない方向へ丸める。
	return { startMs: Math.round(startMs), durationMs: Math.floor(durationMs), contentOffsetMs: 0 };
}

export function getTimelineClipEnd(timing: TimelineClipPlacement): number {
	return timing.startMs + timing.durationMs;
}

export function isTimelineClipActive(timing: TimelineClipPlacement, sceneTimeMs: number): boolean {
	return timing.startMs <= sceneTimeMs && sceneTimeMs < getTimelineClipEnd(timing);
}

export function getTimelineClipContentTime(timing: TimelineClipTiming, sceneTimeMs: number): number {
	// 先にScene上の差を求め、大きな開始時刻への加算で素材位置の小数精度を失わないようにする。
	return timing.contentOffsetMs + (sceneTimeMs - timing.startMs);
}

/** 小数周期の境界を音声・映像・露光で同じ周に所属させる。周期そのものは丸めない。 */
export function getTimelineLoopCycle(startMs: number, periodMs: number, sceneTimeMs: number): number {
	const position = (sceneTimeMs - startMs) / periodMs;
	const nearest = Math.round(position);
	// 配置開始の減算に伴う誤差も含めるが、実際に境界から離れた時刻は丸めない。
	const error = Math.min(1e-7, 4 * Number.EPSILON * Math.max(1, Math.abs(sceneTimeMs), Math.abs(startMs)) / periodMs);
	return Math.floor(Math.abs(position - nearest) <= error ? nearest : position);
}

export function isTimelineClipTimingValid(timing: TimelineClipPlacement): boolean {
	return [timing.startMs, timing.durationMs, getTimelineClipEnd(timing)].every(Number.isSafeInteger)
		&& timing.startMs >= 0 && timing.durationMs > 0;
}

/** 素材の残り時間に収まる整数msの長さ。表示区間の衝突判定には使わない。 */
export function getTimelineMediaMaxDurationMs(contentOffsetMs: number, sourceDurationMs: number, playbackRate = 1): number {
	if (sourceDurationMs === Infinity) return Infinity;
	const speed = Math.abs(playbackRate);
	const remainingMs = (sourceDurationMs - contentOffsetMs) / speed;
	const nearestMs = Math.round(remainingMs);
	// 小数の内容オフセットを左トリムで進めた際、加減算の誤差で残り時間が
	// 整数の直前になることがある。その誤差だけを吸収し、丸々1ms短くなるのを防ぐ。
	// 通常の小数部分は切り捨て、トリム制限と保存時の素材長検証で同じ上限を使う。
	// 短くトリムすると、両端の減算誤差が残り時間に対して大きくなる。
	// 減算前の素材時刻を基準とし、スローで拡大される誤差も配置の時計へ換算する。
	const roundingErrorMs = 4 * Number.EPSILON * Math.max(1, Math.abs(sourceDurationMs), Math.abs(contentOffsetMs)) / speed;
	return Math.abs(remainingMs - nearestMs) <= roundingErrorMs ? nearestMs : Math.floor(remainingMs);
}

/** 境界の接触は許可する。素材の未使用部分は衝突判定に含めない。 */
export function validateTimelineClips(clips: readonly (TimelineClipPlacement & { id: string })[]): void {
	const diagnostics = inspectTimelineClips(clips);
	if (diagnostics.length) throw new Error(diagnostics[0].message);
}

export function inspectTimelineClips(clips: readonly (TimelineClipPlacement & { id: string })[]): ValidationDiagnostic[] {
	const diagnostics: ValidationDiagnostic[] = [];
	if (new Set(clips.map(clip => clip.id)).size !== clips.length) diagnostics.push({ code: 'clip.id', message: 'Duplicate clip ID in layer' });
	const sorted = clips.toSorted((a, b) => a.startMs - b.startMs);
	for (let index = 0; index < sorted.length; index++) {
		if (!isTimelineClipTimingValid(sorted[index])) diagnostics.push({ code: 'clip.timing', message: 'Invalid clip timing' });
		if (index > 0 && getTimelineClipEnd(sorted[index - 1]) > sorted[index].startMs) diagnostics.push({ code: 'clip.overlap', message: 'Overlapping clips in layer' });
	}
	return diagnostics;
}

/** 選択中のクリップ同士は同量だけ移動するため、非選択の隣接区間だけで制限する。 */
export function getTimelineClipMoveBounds(clips: readonly (TimelineClipPlacement & { id: string })[], selectedIds: ReadonlySet<string>, clipId: string): { minDelta: number; maxDelta: number } {
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
export function getTimelineClipInsertionDuration(clips: readonly TimelineClipPlacement[], startMs: number, requestedDurationMs = 5000): number {
	if (!Number.isSafeInteger(startMs) || startMs < 0 || clips.some(clip => isTimelineClipActive(clip, startMs))) return 0;
	const nextStart = clips.reduce((next, clip) => clip.startMs > startMs ? Math.min(next, clip.startMs) : next, Infinity);
	return Math.max(0, Math.floor(Math.min(requestedDurationMs, nextStart - startMs, Number.MAX_SAFE_INTEGER - startMs)));
}

/** UIとコマンドで同じ制限を使う。生成系は左への延長を行わず、Undoだけで元の区間に戻す。 */
export function getTimelineClipTrimBounds(clips: readonly (TimelineClipPlacement & { id: string })[], clip: TimelineClipTiming & { id: string }, edge: 'start' | 'end', canExtendStart: boolean, sourceDurationMs = Infinity): { minDelta: number; maxDelta: number } {
	const bounds = getTimelineClipMoveBounds(clips, new Set([clip.id]), clip.id);
	// 内容オフセットと素材長は小数でも、実際に適用できる移動量は整数msに限る。
	// 下限は切り上げ、上限は切り捨てることで内容時刻0や素材終端を越えない。
	return edge === 'start'
		? { minDelta: canExtendStart ? Math.ceil(Math.max(bounds.minDelta, -clip.contentOffsetMs)) : 0, maxDelta: clip.durationMs - 1 }
		: { minDelta: 1 - clip.durationMs, maxDelta: Math.min(bounds.maxDelta, getTimelineMediaMaxDurationMs(clip.contentOffsetMs, sourceDurationMs) - clip.durationMs) };
}
