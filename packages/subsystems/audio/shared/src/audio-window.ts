import type { StereoPcm } from './pcm.ts';

export type AudioSampleChannel = 'left' | 'right' | 'mix';

/**
 * 固定したPCM区間への読み取り専用ビュー。frameは窓の先頭からの整数位置で、範囲外は0。
 * 配列を公開せず、連続PCMと複数ブロックのどちらでも同じ契約で読み取る。
 */
export interface AudioWindow {
	readonly sampleRate: number;
	readonly frameCount: number;
	sample(frame: number, channel: AudioSampleChannel): number;
}

/** PCMをコピーせず包む。呼び出し側は、このビューが使われる間は配列を変更・再利用しない。 */
export function createAudioWindow(sampleRate: number, channels: Readonly<StereoPcm>): AudioWindow {
	const [left, right] = channels;
	return {
		sampleRate,
		frameCount: left.length,
		sample(frame, channel) {
			if (channel === 'left') return left[frame] ?? 0;
			if (channel === 'right') return right[frame] ?? 0;
			return ((left[frame] ?? 0) + (right[frame] ?? 0)) * 0.5;
		},
	};
}
