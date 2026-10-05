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

/** Assetの参照を解決する。PCM・デコーダー・キャッシュは音声subsystemが所有する。 */
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

	read(assetId: string, time: number, frames: number, rate: number): Promise<StereoPcm> {
		return this.reader.read(assetId, time, frames, rate);
	}

	dispose() { this.reader.dispose(); }
}
