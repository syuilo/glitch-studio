import { VideoSampleSink } from 'mediabunny';
import type { FileSource } from '../file-source.ts';
import { createMediaInput } from './media-input.ts';
import { VideoSampleReader } from './video-sample-reader.ts';

/** 排他的な境界の直前。FPSではなく隣接する浮動小数点数を使い、可変FPSにも対応する。 */
function before(time: number): number {
	if (time === 0) return -Number.MIN_VALUE;
	const bits = new DataView(new ArrayBuffer(8));
	bits.setFloat64(0, time);
	bits.setBigUint64(0, bits.getBigUint64(0) + (time > 0 ? -1n : 1n));
	return bits.getFloat64(0);
}

/** コンテナの時刻をそのまま使う。映像だけの先頭を0へずらすと音声との同期が失われる。 */
export function openVideoSource(fileSource: FileSource) {
	const input = createMediaInput(fileSource);
	let disposed = false;
	let reader: VideoSampleReader | null = null;
	const initialize = async () => {
		const track = await input.getPrimaryVideoTrack();
		if (track == null || !await track.canDecode()) throw new Error('Video track cannot be decoded.');
		const firstTimestamp = await track.getFirstTimestamp();
		const endTimestamp = await track.computeDuration();
		const timeResolution = await track.getTimeResolution();
		if (!Number.isFinite(firstTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < firstTimestamp) {
			throw new Error('Video track has an invalid time range.');
		}
		if (!Number.isFinite(timeResolution) || timeResolution <= 0) throw new Error('Video track has an invalid time resolution.');
		return { sink: new VideoSampleSink(track), firstTimestamp, endTimestamp, timeResolution };
	};
	let ready: ReturnType<typeof initialize> | null = null;
	const prepare = async () => {
		if (disposed) throw new Error('Video source is disposed.');
		const entry = await (ready ??= initialize());
		if (disposed) throw new Error('Video source is disposed.');
		return entry;
	};
	return {
		prepare,
		async getSample(timeSeconds: number, reverse = false) {
			if (!Number.isFinite(timeSeconds)) throw new Error('Video time must be finite.');
			const entry = await prepare();
			// getSampleは終端以降も最終フレームを返すので、タイムライン側の透明区間を明示する。
			// 範囲判定は丸め前の時刻で行い、開始前の透明区間や逆方向の排他的終端を維持する。
			const rangeTime = reverse ? before(timeSeconds) : timeSeconds;
			if (rangeTime < 0 || rangeTime < entry.firstTimestamp || rangeTime >= entry.endTimestamp) {
				reader?.reset();
				return null;
			}
			// WebMの1ms精度では60fpsの16.666...msが17msとして格納される。生の要求時刻で
			// 比較すると一枚前を選び、同じ映像の重複と飛びが生じる。デコーダーの出力と同じ
			// トラックの時刻精度へ揃える。FPSや固定の許容誤差には依存せず、可変FPSにも適用する。
			const roundedTime = Math.round(timeSeconds * entry.timeResolution) / entry.timeResolution;
			// 逆方向の境界は丸めた後で排他的にする。先にbefore()すると、丸めで元の境界に戻る。
			// 区間内からの丸めが先頭・終端を越えても、透明画像や区間外のフレームにしない。
			const sampleTime = Math.max(entry.firstTimestamp, Math.min(reverse ? before(roundedTime) : roundedTime, before(entry.endTimestamp)));
			reader ??= new VideoSampleReader(entry.sink);
			return reader.getSample(sampleTime, reverse);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			reader?.dispose();
			input.dispose();
		},
	};
}
