import type { AudioWindow } from './audio-window.ts';

/**
 * 1回の描画に固定した音声入力。基準時刻や取得元の解釈は呼び出し側が所有する。
 * 返したPCMは借用・読み取り専用。取得中も基準時刻と変更世代を変えてはいけない。
 */
export interface AudioInput {
	readonly cacheKey: string;
	/** 同じサンプル座標・PCMを共有する取得元と変更世代。通常の追記では変えない。 */
	readonly sourceKey: string;
	readonly sampleRate: number;
	/** 読めるPCMの先頭。過去を任意に取得できる入力は-Infinity。範囲外はゼロで埋める。 */
	readonly startFrame: number;
	/** readWindowが返す半開区間の終端（このフレーム自身は含まない）。 */
	readonly endFrame: number;
	readWindow: (durationSeconds: number, signal: AbortSignal) => AudioWindow | Promise<AudioWindow>;
}

export function getAudioWindowFrameCount(durationSeconds: number, sampleRate: number): number {
	if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Invalid audio window duration');
	const frames = Math.max(2, Math.round(durationSeconds * sampleRate));
	if (!Number.isSafeInteger(frames)) throw new Error('Audio window is too long');
	return frames;
}
