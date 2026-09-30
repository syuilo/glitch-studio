import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';

export type VideoMetadata = {
	durationMs: number;
	hasAudio: boolean;
	audioError: string | null;
};

const metadata = new WeakMap<Blob, Promise<VideoMetadata>>();

/** Blobは不変。レイヤーごとに同じ素材を走査せず、失敗した取得だけ再試行できるようにする。 */
export function readVideoMetadata(blob: Blob): Promise<VideoMetadata> {
	let pending = metadata.get(blob);
	if (!pending) {
		pending = inspectVideo(blob).catch(error => { metadata.delete(blob); throw error; });
		metadata.set(blob, pending);
	}
	return pending;
}

async function inspectVideo(blob: Blob): Promise<VideoMetadata> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const video = await input.getPrimaryVideoTrack();
		if (!video || !await video.canDecode()) throw new Error('Video track cannot be decoded.');
		const firstTimestamp = await video.getFirstTimestamp();
		const videoEnd = await video.computeDuration();
		if (!Number.isFinite(firstTimestamp) || !Number.isFinite(videoEnd) || videoEnd <= Math.max(0, firstTimestamp)) {
			throw new Error('Video has no finite duration.');
		}
		const audio = await input.getPrimaryAudioTrack();
		const audioEnd = audio ? await audio.computeDuration() : 0;
		if (!Number.isFinite(audioEnd)) throw new Error('Audio has no finite duration.');
		// 音声の有効・無効で素材長やPROGRESSを変えない。デコード可否は追加時に選択できる。
		let audioError: string | null = null;
		if (audio) {
			if (!await audio.canDecode()) audioError = 'Audio decoding is unavailable.';
			else if (audio.numberOfChannels > 2) audioError = 'Only mono and stereo audio are supported.';
		}
		return { durationMs: Math.max(videoEnd, audioEnd) * 1000, hasAudio: audio != null, audioError };
	} finally { input.dispose(); }
}
