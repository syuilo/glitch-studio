import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import type { InputTrack } from 'mediabunny';

export type MediaTrackTiming = { firstTimestamp: number; endTimestamp: number };
export type MediaMetadata = {
	durationMs: number;
	video: MediaTrackTiming | null;
	audio: (MediaTrackTiming & { numberOfChannels: number }) | null;
};

const metadata = new WeakMap<Blob, Promise<MediaMetadata>>();

/** 素材の事実だけを取得する。デコード対応や利用側のチャンネル制限には依存しない。 */
export function readMediaMetadata(blob: Blob): Promise<MediaMetadata> {
	let pending = metadata.get(blob);
	if (!pending) {
		pending = inspectMedia(blob).catch(error => { metadata.delete(blob); throw error; });
		metadata.set(blob, pending);
	}
	return pending;
}

async function readTiming(track: InputTrack): Promise<MediaTrackTiming> {
	const firstTimestamp = await track.getFirstTimestamp();
	const endTimestamp = await track.computeDuration();
	if (!Number.isFinite(firstTimestamp) || !Number.isFinite(endTimestamp) || endTimestamp < firstTimestamp) {
		throw new Error('Media track has an invalid time range.');
	}
	return { firstTimestamp, endTimestamp };
}

async function inspectMedia(blob: Blob): Promise<MediaMetadata> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const videoTrack = await input.getPrimaryVideoTrack();
		const audioTrack = await input.getPrimaryAudioTrack();
		const video = videoTrack ? await readTiming(videoTrack) : null;
		const audio = audioTrack ? { ...await readTiming(audioTrack), numberOfChannels: await audioTrack.getNumberOfChannels() } : null;
		// 主映像・主音声の共通原点からの長さ。音声の有効・無効では変えない。
		return { durationMs: Math.max(0, video?.endTimestamp ?? 0, audio?.endTimestamp ?? 0) * 1000, video, audio };
	} finally { input.dispose(); }
}
