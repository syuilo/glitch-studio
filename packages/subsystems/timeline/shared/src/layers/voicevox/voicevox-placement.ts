import { getVoicevoxRequest } from './voicevox.ts';
import { getTimelineClipEnd } from '../../timing.ts';
import type { PreparedSpeech, VoicevoxRequest, VoicevoxSettings, VoicevoxUtterance } from './voicevox.ts';
import type { TimelineClip } from '../../clip.ts';

type SpeechInterval = { sourceStartMs: number; startMs: number; endMs: number };
export type VoicevoxUtteranceInterval = SpeechInterval & { utteranceId: string; request: VoicevoxRequest };
export type VoicevoxUtterancePlacement = VoicevoxUtteranceInterval & { clipId: string };

/** 次のキーまで発話を有効にする。空の本文も直前の発話を終了させるキーとして扱う。 */
export function getVoicevoxUtteranceIntervals(settings: VoicevoxSettings, utterances: readonly VoicevoxUtterance[]): VoicevoxUtteranceInterval[] {
	const sorted = utterances.toSorted((a, b) => a.timeMs - b.timeMs);
	return sorted.flatMap((utterance, index) => utterance.text === '' ? [] : [{
		utteranceId: utterance.id,
		request: getVoicevoxRequest(settings, utterance),
		sourceStartMs: utterance.timeMs,
		startMs: utterance.timeMs,
		endMs: sorted[index + 1]?.timeMs ?? Infinity,
	}]);
}

/** 未生成でも決まる配置区間。音声の長さは割当時に適用し、生成対象の列挙にも使う。 */
export function getVoicevoxUtterancePlacements(settings: VoicevoxSettings, utterances: readonly VoicevoxUtterance[], clips: readonly TimelineClip[]): VoicevoxUtterancePlacement[] {
	return getVoicevoxUtteranceIntervals(settings, utterances).flatMap(interval => clips.flatMap(clip => {
		const startMs = Math.max(interval.startMs, clip.startMs);
		const endMs = Math.min(interval.endMs, getTimelineClipEnd(clip));
		// 左トリム・クリップの分離でも素材時刻0は発話キーに固定し、途中からの音声を使う。
		return endMs > startMs ? [{ ...interval, clipId: clip.id, startMs, endMs }] : [];
	}));
}

/** 配置と生成結果を結び付ける。生成済みでも配置区間より前に音声が終われば出力しない。 */
export function assignPreparedSpeech(interval: SpeechInterval, speech: PreparedSpeech): (SpeechInterval & { sourceId: string }) | undefined {
	const endMs = Math.min(interval.endMs, interval.sourceStartMs + speech.durationMs);
	if (endMs <= interval.startMs) return undefined;
	return { sourceId: speech.sourceId, sourceStartMs: interval.sourceStartMs, startMs: interval.startMs, endMs };
}
