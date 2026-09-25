import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import type { VideoSample } from 'mediabunny';
import { videoTimestamp } from './frame-loader.ts';
import type { VideoFrameSource } from './frame-loader.ts';

export function openVideoFrameSource(blob: Blob): VideoFrameSource<VideoSample> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	let disposed = false;
	const initialize = async () => {
		const track = await input.getPrimaryVideoTrack();
		if (!track || !await track.canDecode()) throw new Error('Video track cannot be decoded.');
		const firstTimestamp = await track.getFirstTimestamp();
		// computeDurationは最終サンプルの終了タイムスタンプを返す（先頭との差ではない）。
		const endTimestamp = await track.computeDuration();
		if (!Number.isFinite(firstTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < firstTimestamp) {
			throw new Error('Video track has an invalid time range.');
		}
		return { sink: new VideoSampleSink(track), firstTimestamp, endTimestamp };
	};
	let ready: ReturnType<typeof initialize> | undefined;
	return {
		async getSample(position) {
			if (disposed) throw new Error('Video source is disposed.');
			const { sink, firstTimestamp, endTimestamp } = await (ready ??= initialize());
			if (disposed) throw new Error('Video source is disposed.');
			return sink.getSample(videoTimestamp(position, firstTimestamp, endTimestamp));
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			input.dispose();
		},
	};
}
