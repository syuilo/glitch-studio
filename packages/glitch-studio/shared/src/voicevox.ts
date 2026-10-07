import { getVoicevoxRequests } from '@gs/subsystems_timeline_shared/voicevox-requests.ts';
import { getVoicevoxRequestKey } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { PreparedSpeech } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';

/** 生成音声はAsset一覧から独立したプロジェクトのリソースとして保存する。 */
export type GeneratedSpeech = PreparedSpeech & {
	fileData: Blob;
	engineVersion: string;
	audioQuery: Record<string, unknown>;
};
export type VoicevoxSpeaker = { name: string; speaker_uuid: string; styles: { id: number; name: string; type?: string }[] };

/** 保存するのは現在の発話から参照される音声だけ。Undo用の旧結果はUIの一時キャッシュが所有する。 */
export function getReferencedGeneratedSpeech(scenes: readonly TimelineScene[], speech: readonly GeneratedSpeech[]): GeneratedSpeech[] {
	const keys = new Set(getVoicevoxRequests(scenes).map(getVoicevoxRequestKey));
	return speech.filter(item => keys.has(item.key));
}
