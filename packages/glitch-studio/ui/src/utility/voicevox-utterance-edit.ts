import { genId } from '@gs/shared/utility/id.ts';
import { keyframeMoveBounds } from './timeline-selection.ts';
import { getVoicevoxSubtitlePlacements } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle-timing.ts';
import { getTimelineClipEnd } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';

/** 同時刻のキーがあればそれを選び、ダブルクリックで発話を重複作成しない。 */
export function insertVoicevoxUtterance(utterances: readonly VoicevoxUtterance[], timeMs: number) {
	const time = Math.max(0, Math.round(timeMs));
	if (!Number.isSafeInteger(time)) return null;
	const existing = utterances.find(utterance => utterance.timeMs === time);
	if (existing) return { utterance: existing, utterances };
	// 保存順や選択中のキーによらず、追加時刻で直前の声を引き継ぐ。
	// 先頭への追加は最初の発話の声を使い、空レイヤーでのみ既定のスタイルを使う。
	// 値としてコピーするため、後から継承元を編集・移動しても新しい発話の声は変わらない。
	const sorted = utterances.toSorted((a, b) => a.timeMs - b.timeMs);
	const source = sorted.findLast(utterance => utterance.timeMs < time) ?? sorted[0];
	const utterance: VoicevoxUtterance = { id: genId(), timeMs: time, text: '', reading: null, styleId: source?.styleId ?? 1, subtitleDurationMs: null };
	return { utterance, utterances: [...utterances, utterance] };
}

/** 自動から指定へ切り替える時だけ音声長を初期値に使い、未生成なら現在の表示区間を使う。 */
export function getDefaultVoicevoxSubtitleDuration(utterances: readonly VoicevoxUtterance[], clips: readonly TimelineClip[], id: string, speechDurationMs?: number): number {
	const utterance = utterances.find(utterance => utterance.id === id);
	if (!utterance) return 0;
	// 保存する字幕長は整数msなので、音声末尾が欠けないよう小数msを切り上げる。
	// ここで値を確定し、後から生成結果が変わっても指定長は変更しない。
	if (speechDurationMs != null) return Math.min(Number.MAX_SAFE_INTEGER - utterance.timeMs, Math.ceil(speechDurationMs));
	const nextTime = Math.min(...utterances.filter(key => key.timeMs > utterance.timeMs).map(key => key.timeMs));
	const clipEnd = Math.max(utterance.timeMs, ...clips.map(getTimelineClipEnd));
	const end = Math.min(nextTime, clipEnd > utterance.timeMs ? clipEnd : utterance.timeMs + 5000, Number.MAX_SAFE_INTEGER);
	return Math.max(0, end - utterance.timeMs);
}

/** 操作中に自動状態を指定へ変えない。ハンドルは保存した終端が見える配置だけで有効にする。 */
export function getVoicevoxSubtitleTrimBounds(utterances: readonly VoicevoxUtterance[], clips: readonly TimelineClip[], id: string, clipId: string) {
	const utterance = utterances.find(key => key.id === id);
	const clip = clips.find(clip => clip.id === clipId);
	if (!utterance || !clip || utterance.subtitleDurationMs === null) return null;
	const placement = getVoicevoxSubtitlePlacements(utterances, clips).find(range => range.utteranceId === id && range.clipId === clipId);
	if (!placement?.canResize) return null;
	const nextTime = Math.min(...utterances.filter(key => key.timeMs > utterance.timeMs).map(key => key.timeMs));
	return { endMs: placement.endMs, minDelta: -utterance.subtitleDurationMs,
		maxDelta: Math.min(nextTime, getTimelineClipEnd(clip), Number.MAX_SAFE_INTEGER) - placement.endMs };
}

export function getVoicevoxUtteranceTimeBounds(utterances: readonly VoicevoxUtterance[], id: string) {
	const utterance = utterances.find(utterance => utterance.id === id);
	if (!utterance) return null;
	// 発話は同時刻を許可しないため、未選択の隣のキーとの間に1msを残す。
	const bounds = keyframeMoveBounds(utterances.map(utterance => ({ id: utterance.id, x: utterance.timeMs })), new Set([id]), id, 1);
	return { min: utterance.timeMs + bounds.minDelta, max: utterance.timeMs + bounds.maxDelta };
}
