import { openVideoSource } from '@gs/shared/media/video-source.ts';
import type { VideoSample } from 'mediabunny';
import { videoTimestamp } from './frame-loader.ts';
import type { VideoFrameSource } from './frame-loader.ts';

// ノードの0〜1の時刻表現はエフェクト側で解釈し、共通の動画読み取りへ持ち込まない。
export function openVideoFrameSource(blob: Blob): VideoFrameSource<VideoSample> {
	const source = openVideoSource(blob);
	return {
		async getSample(position) {
			const { sink, firstTimestamp, endTimestamp } = await source.prepare();
			return sink.getSample(videoTimestamp(position, firstTimestamp, endTimestamp));
		},
		dispose: () => source.dispose(),
	};
}
