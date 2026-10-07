import { genId } from '@gs/shared/utility/id.ts';
import { keyframeMoveBounds } from './timeline-selection.ts';
import type { VoicevoxUtterance } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';

/** 同時刻のキーがあればそれを選び、ダブルクリックで発話を重複作成しない。 */
export function insertVoicevoxUtterance(utterances: readonly VoicevoxUtterance[], timeMs: number) {
	const time = Math.max(0, Math.round(timeMs));
	if (!Number.isSafeInteger(time)) return null;
	const existing = utterances.find(utterance => utterance.timeMs === time);
	const utterance = existing ?? { id: genId(), timeMs: time, text: '', reading: null };
	return { utterance, utterances: existing ? utterances : [...utterances, utterance] };
}

export function getVoicevoxUtteranceTimeBounds(utterances: readonly VoicevoxUtterance[], id: string) {
	const utterance = utterances.find(utterance => utterance.id === id);
	if (!utterance) return null;
	// 発話は同時刻を許可しないため、未選択の隣のキーとの間に1msを残す。
	const bounds = keyframeMoveBounds(utterances.map(utterance => ({ id: utterance.id, x: utterance.timeMs })), new Set([id]), id, 1);
	return { min: utterance.timeMs + bounds.minDelta, max: utterance.timeMs + bounds.maxDelta };
}
