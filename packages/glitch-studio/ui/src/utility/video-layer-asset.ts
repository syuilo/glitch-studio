import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { readMediaMetadata } from '@gs/shared/media/media-metadata.ts';
import { getAudioTrackError } from '@gs/subsystems_audio_renderer/audio-track-support.ts';

/** 追加・音声有効化のための判定。音声の非対応は、映像だけで使う選択肢として返す。 */
export async function inspectVideoLayerAsset(blob: Blob) {
	const metadata = await readMediaMetadata(blob);
	if (!metadata.video || metadata.video.endTimestamp <= Math.max(0, metadata.video.firstTimestamp)) {
		throw new Error('Video has no finite duration.');
	}
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const video = await input.getPrimaryVideoTrack();
		if (!video || !await video.canDecode()) throw new Error('Video track cannot be decoded.');
		const audio = await input.getPrimaryAudioTrack();
		return { metadata, audioError: audio ? getAudioTrackError({ decodable: await audio.canDecode(), numberOfChannels: await audio.getNumberOfChannels() }) : null };
	} finally { input.dispose(); }
}
