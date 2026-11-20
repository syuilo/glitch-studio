import type { FileSource } from '@gs/shared/file-source.ts';
import { openVideoSource } from '@gs/shared/media/video-source.ts';
import type { VideoSample } from 'mediabunny';
import { videoTimestamp } from './video-time.ts';

// ノードの0〜1の時刻表現はエフェクト側で解釈し、共通の動画読み取りへ持ち込まない。
export function openVideoFrameSource(fileSource: FileSource) {
	const source = openVideoSource(fileSource);
	return {
		async getSample(position: number): Promise<VideoSample | null> {
			const { sink, firstTimestamp, endTimestamp } = await source.prepare();
			return sink.getSample(videoTimestamp(position, firstTimestamp, endTimestamp));
		},
		dispose: () => source.dispose(),
	};
}
