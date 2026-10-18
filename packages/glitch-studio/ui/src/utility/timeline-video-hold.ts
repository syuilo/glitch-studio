import { openVideoSource } from '@gs/shared/media/video-source.ts';
import type { FileSource } from '@gs/shared/file-source.ts';

/** 固定操作の時点で実フレームを確定する。可変FPSや逆再生の排他的な境界も描画と同じ規則で読む。 */
export async function readTimelineVideoHoldFrame(fileSource: FileSource, sourceTimeMs: number, reversePlayback = false): Promise<{ sourceTimeMs: number; sourceDurationMs: number }> {
	const source = openVideoSource(fileSource);
	try {
		const { endTimestamp } = await source.prepare();
		const sample = await source.getSample(sourceTimeMs / 1000, reversePlayback);
		if (sample == null) throw new Error('There is no video frame at this source time.');
		try {
			let timeMs = sample.timestamp * 1000;
			// 秒→ms→秒の丸めでフレーム先頭の直前に戻ると、固定後に一枚前へ変わってしまう。
			// 戻りの値が先頭を下回る場合だけ、msの浮動小数点精度の範囲で上側へ補正する。
			if (timeMs / 1000 < sample.timestamp) timeMs += Number.EPSILON * Math.max(1, Math.abs(timeMs));
			return { sourceTimeMs: timeMs, sourceDurationMs: endTimestamp * 1000 };
		} finally { sample.close(); }
	} finally { source.dispose(); }
}
