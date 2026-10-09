import { getTimelineClipEnd } from '../../timing.ts';
import type { TimelineClip } from '../../clip.ts';
import { getVoicevoxRequest } from './voicevox.ts';
import type { SpeechResolver, VoicevoxSettings, VoicevoxUtterance } from './voicevox.ts';

export type VoicevoxSubtitleInterval = { utteranceId: string; text: string; startMs: number; endMs: number; isAutomatic: boolean };
export type VoicevoxSubtitlePlacement = VoicevoxSubtitleInterval & { clipId: string; canResize: boolean };

/** 空文字・表示長0のキーでも前の字幕を打ち切り、後の字幕が終わっても前の字幕へ戻らない。 */
export function getVoicevoxSubtitleIntervals(settings: VoicevoxSettings, utterances: readonly VoicevoxUtterance[], resolveSpeech?: SpeechResolver): VoicevoxSubtitleInterval[] {
	const sorted = utterances.toSorted((a, b) => a.timeMs - b.timeMs);
	return sorted.flatMap((utterance, index) => {
		const duration = utterance.subtitleDuration;
		let durationMs = Infinity;
		if (duration.mode === 'specified') durationMs = duration.durationMs;
		if (duration.mode === 'speech') {
			const speech = resolveSpeech?.(getVoicevoxRequest(settings, utterance));
			// 未生成でも字幕を編集できるよう、音声長が分かるまでは従来の自動区間を仮表示する。
			// 生成音声の小数msは丸めず、延長0で音声と字幕の終端を一致させる。
			if (speech) durationMs = speech.durationMs + duration.extensionMs;
		}
		const endMs = Math.min(sorted[index + 1]?.timeMs ?? Infinity, utterance.timeMs + durationMs);
		return utterance.text !== '' && endMs > utterance.timeMs ? [{
			utteranceId: utterance.id, text: utterance.text, startMs: utterance.timeMs, endMs, isAutomatic: duration.mode !== 'specified',
		}] : [];
	});
}

/** クリップで切った見た目の端を字幕の終了ハンドルにしない。保存長は切らず、表示だけ制限する。 */
export function getVoicevoxSubtitlePlacements(settings: VoicevoxSettings, utterances: readonly VoicevoxUtterance[], clips: readonly TimelineClip[], resolveSpeech?: SpeechResolver): VoicevoxSubtitlePlacement[] {
	const byId = new Map(utterances.map(utterance => [utterance.id, utterance]));
	return getVoicevoxSubtitleIntervals(settings, utterances, resolveSpeech).flatMap(interval => clips.flatMap(clip => {
		const startMs = Math.max(interval.startMs, clip.startMs);
		const endMs = Math.min(interval.endMs, getTimelineClipEnd(clip));
		const utterance = byId.get(interval.utteranceId)!;
		const duration = utterance.subtitleDuration;
		const canResize = duration.mode === 'specified' && endMs === utterance.timeMs + duration.durationMs;
		return endMs > startMs ? [{ ...interval, clipId: clip.id, startMs, endMs, canResize }] : [];
	}));
}

export function getVoicevoxSubtitle(settings: VoicevoxSettings, utterances: readonly VoicevoxUtterance[], sceneTimeMs: number, resolveSpeech?: SpeechResolver): string {
	return getVoicevoxSubtitleIntervals(settings, utterances, resolveSpeech).find(interval => interval.startMs <= sceneTimeMs && sceneTimeMs < interval.endMs)?.text ?? '';
}
