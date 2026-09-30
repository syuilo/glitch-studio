import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { VideoSampleReader } from './video-sample-reader.ts';

/** コンテナの時刻をそのまま使う。映像だけの先頭を0へずらすと音声との同期が失われる。 */
export function openVideoSource(blob: Blob) {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	let disposed = false;
	let reader: VideoSampleReader | undefined;
	const initialize = async () => {
		const track = await input.getPrimaryVideoTrack();
		if (!track || !await track.canDecode()) throw new Error('Video track cannot be decoded.');
		const firstTimestamp = await track.getFirstTimestamp();
		const endTimestamp = await track.computeDuration();
		if (!Number.isFinite(firstTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < firstTimestamp) {
			throw new Error('Video track has an invalid time range.');
		}
		return { sink: new VideoSampleSink(track), firstTimestamp, endTimestamp };
	};
	let ready: ReturnType<typeof initialize> | undefined;
	const prepare = async () => {
		if (disposed) throw new Error('Video source is disposed.');
		const entry = await (ready ??= initialize());
		if (disposed) throw new Error('Video source is disposed.');
		return entry;
	};
	return {
		prepare,
		async getSample(timeSeconds: number) {
			if (!Number.isFinite(timeSeconds)) throw new Error('Video time must be finite.');
			const entry = await prepare();
			// getSampleは終端以降も最終フレームを返すので、タイムライン側の透明区間を明示する。
			if (timeSeconds < 0 || timeSeconds < entry.firstTimestamp || timeSeconds >= entry.endTimestamp) {
				reader?.reset();
				return null;
			}
			reader ??= new VideoSampleReader(entry.sink);
			return reader.getSample(timeSeconds);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			reader?.dispose();
			input.dispose();
		},
	};
}
