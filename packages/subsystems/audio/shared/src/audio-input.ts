import type { StereoPcm } from './pcm.ts';

export type AudioWindow = { sampleRate: number; channels: Readonly<StereoPcm> };

/**
 * 1回の描画に固定した音声入力。基準時刻や取得元の解釈は呼び出し側が所有する。
 * 返したPCMは借用・読み取り専用。取得中も基準時刻と変更世代を変えてはいけない。
 */
export interface AudioInput {
	readonly cacheKey: string;
	readWindow: (durationSeconds: number, signal: AbortSignal) => AudioWindow | Promise<AudioWindow>;
}

export function getAudioWindowFrameCount(durationSeconds: number, sampleRate: number): number {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio window duration');
	const frames = Math.max(2, Math.round(durationSeconds * sampleRate));
	if (!Number.isSafeInteger(frames)) throw new Error('Audio window is too long');
	return frames;
}
