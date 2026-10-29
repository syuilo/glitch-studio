import type { FileSource } from '@gs/shared/file-source.ts';
import { createMediaInput } from '@gs/shared/media/media-input.ts';

/** 新規プロジェクトのfpsに使う推定値。判定できない場合は呼び出し側の既定値を使う。 */
export async function readVideoFrameRate(fileSource: FileSource): Promise<number | null> {
	const input = createMediaInput(fileSource);
	try {
		const track = await input.getPrimaryVideoTrack();
		if (track == null) return null;
		// 全編の走査やデコードを避け、先頭付近のタイムスタンプから推定する。
		// bestGuessFrameRateはWebMの時刻丸めや可変fpsも考慮した代表値で、
		// 30000/1001などの小数fpsも整数へ丸めずにプロジェクトへ引き継ぐ。
		const metrics = await track.computeFrameRateMetrics();
		const frameRate = metrics.bestGuessFrameRate;
		return metrics.probedPacketCount >= 2 && Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
	} catch {
		// fpsの推定に失敗しても、読み込み可能な動画からのプロジェクト作成は妨げない。
		return null;
	} finally {
		input.dispose();
	}
}
