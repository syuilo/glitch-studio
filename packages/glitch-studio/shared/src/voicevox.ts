import type { PreparedSpeech } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox.ts';

/** 生成音声はAsset一覧から独立したプロジェクトのリソースとして保存する。 */
export type GeneratedSpeech = PreparedSpeech & {
	fileData: Blob;
	engineVersion: string;
	audioQuery: Record<string, unknown>;
};
export type VoicevoxSpeaker = { name: string; speaker_uuid: string; styles: { id: number; name: string; type?: string }[] };
