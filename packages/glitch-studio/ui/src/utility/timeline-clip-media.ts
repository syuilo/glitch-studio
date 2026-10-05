import type { Asset } from '@gs/shared/types.ts';
import { inspectVideoLayerAsset } from './video-layer-asset.ts';
import { openAssetAudio } from '../audio/asset-audio-reader.ts';

export type TimelineClipMediaInfo = { durationMs: number; audioAvailable: boolean; audioError: string | null };

// 同じ素材を複数クリップに配置しても、メタデータを何度もデコードしない。
// Blobの寿命に追従し、プロジェクトを閉じた後にファイルを保持し続けない。
const metadataCache = new WeakMap<Blob, Promise<TimelineClipMediaInfo>>();

export function inspectTimelineClipMedia(asset: Asset): Promise<TimelineClipMediaInfo> {
	const blob = asset.fileData;
	const cached = metadataCache.get(blob);
	if (cached) return cached;
	const pending = (async () => {
		if (asset.fileDataType.startsWith('video/')) {
			const { metadata, audioError } = await inspectVideoLayerAsset(blob);
			return { durationMs: metadata.durationMs, audioAvailable: metadata.audio != null && !audioError, audioError };
		}
		const audio = await openAssetAudio(asset);
		try {
			return { durationMs: audio.durationSeconds * 1000, audioAvailable: true, audioError: null };
		} finally { audio.dispose(); }
	})();
	metadataCache.set(blob, pending);
	void pending.catch(() => { metadataCache.delete(blob); });
	return pending;
}
