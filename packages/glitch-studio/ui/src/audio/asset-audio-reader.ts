import { readMediaMetadata } from '@gs/shared/media/media-metadata.ts';
import { openAudioFile } from '@gs/subsystems_audio_renderer/audio-file.ts';
import { AudioFileReader } from '@gs/subsystems_audio_renderer/audio-file-reader.ts';
import type { AudioFileReaderOptions } from '@gs/subsystems_audio_renderer/audio-file-reader.ts';
import type { StereoPcm } from '@gs/subsystems_audio_shared/pcm.ts';
import type { Asset } from '@gs/shared/types.ts';

export async function openAssetAudio(asset: Asset) {
	try {
		return await openAudioFile(asset.fileData);
	} catch (error) {
		// デコーダーはAssetを知らないため、ユーザー向けの素材名はアプリ側で補う。
		throw new Error(`${asset.name}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
}

/** Assetの参照解決と素材長の用途を扱う。PCM・デコーダー・キャッシュは音声subsystemが所有する。 */
export class AssetAudioReader {
	private reader: AudioFileReader;

	constructor(private assets: readonly Asset[], options: AudioFileReaderOptions & { open?: typeof openAssetAudio } = {}) {
		const open = options.open ?? openAssetAudio;
		this.reader = new AudioFileReader(async assetId => {
			const asset = this.assets.find(asset => asset.id === assetId);
			if (!asset) throw new Error(`Audio asset not found: ${assetId}`);
			return open(asset);
		}, options);
	}

	async getDurationMs(assetId: string, basis: 'audio' | 'media' = 'audio'): Promise<number> {
		if (basis === 'media') {
			const asset = this.assets.find(asset => asset.id === assetId);
			if (!asset) throw new Error('Media asset not found: ' + assetId);
			return (await readMediaMetadata(asset.fileData)).durationMs;
		}
		return this.reader.getDurationMs(assetId);
	}

	read(assetId: string, time: number, frames: number, rate: number): Promise<StereoPcm> {
		return this.reader.read(assetId, time, frames, rate);
	}

	dispose() { this.reader.dispose(); }
}
