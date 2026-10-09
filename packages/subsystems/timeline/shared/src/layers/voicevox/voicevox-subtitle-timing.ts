import { getTimelineClipEnd } from '../../timing.ts';
import type { TimelineClip } from '../../clip.ts';
import type { VoicevoxUtterance } from './voicevox.ts';

export type VoicevoxSubtitleInterval = { utteranceId: string; text: string; startMs: number; endMs: number; isAutomatic: boolean };
export type VoicevoxSubtitlePlacement = VoicevoxSubtitleInterval & { clipId: string; canResize: boolean };

/** 音声の生成状況とは独立して字幕を決める。空文字・表示長0のキーでも前の字幕を打ち切る。 */
export function getVoicevoxSubtitleIntervals(utterances: readonly VoicevoxUtterance[]): VoicevoxSubtitleInterval[] {
	const sorted = utterances.toSorted((a, b) => a.timeMs - b.timeMs);
	return sorted.flatMap((utterance, index) => {
		const endMs = Math.min(sorted[index + 1]?.timeMs ?? Infinity, utterance.subtitleDurationMs === null ? Infinity : utterance.timeMs + utterance.subtitleDurationMs);
		return utterance.text !== '' && endMs > utterance.timeMs ? [{
			utteranceId: utterance.id, text: utterance.text, startMs: utterance.timeMs, endMs, isAutomatic: utterance.subtitleDurationMs === null,
		}] : [];
	});
}

/** クリップで切った見た目の端を字幕の終了ハンドルにしない。保存長は切らず、表示だけ制限する。 */
export function getVoicevoxSubtitlePlacements(utterances: readonly VoicevoxUtterance[], clips: readonly TimelineClip[]): VoicevoxSubtitlePlacement[] {
	const byId = new Map(utterances.map(utterance => [utterance.id, utterance]));
	return getVoicevoxSubtitleIntervals(utterances).flatMap(interval => clips.flatMap(clip => {
		const startMs = Math.max(interval.startMs, clip.startMs);
		const endMs = Math.min(interval.endMs, getTimelineClipEnd(clip));
		const utterance = byId.get(interval.utteranceId)!;
		const canResize = !interval.isAutomatic && endMs === utterance.timeMs + utterance.subtitleDurationMs!;
		return endMs > startMs ? [{ ...interval, clipId: clip.id, startMs, endMs, canResize }] : [];
	}));
}
