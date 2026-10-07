import { genId } from '@gs/shared/utility/id.ts';
import { keyframeMoveBounds } from './timeline-selection.ts';
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
	const utterance: VoicevoxUtterance = { id: genId(), timeMs: time, text: '', reading: null, styleId: source?.styleId ?? 1 };
	return { utterance, utterances: [...utterances, utterance] };
}

export function getVoicevoxUtteranceTimeBounds(utterances: readonly VoicevoxUtterance[], id: string) {
	const utterance = utterances.find(utterance => utterance.id === id);
	if (!utterance) return null;
	// 発話は同時刻を許可しないため、未選択の隣のキーとの間に1msを残す。
	const bounds = keyframeMoveBounds(utterances.map(utterance => ({ id: utterance.id, x: utterance.timeMs })), new Set([id]), id, 1);
	return { min: utterance.timeMs + bounds.minDelta, max: utterance.timeMs + bounds.maxDelta };
}
