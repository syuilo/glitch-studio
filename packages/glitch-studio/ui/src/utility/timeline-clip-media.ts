import { openAssetAudio } from '../audio/project-audio-reader.ts';
import { inspectVideoLayerAsset } from './video-layer-asset.ts';
import type { Asset } from '@gs/shared/types.ts';

export type TimelineClipMediaInfo = { durationMs: number; audioAvailable: boolean; audioError: string | null };

// クリップIDはレイヤー内でだけ一意。同じIDのクリップを含むグループでも素材長を混同しない。
export type TimelineClipSourceDurations = Record<string, Record<string, number>>;

// 同じ素材を複数クリップに配置しても、メタデータを何度もデコードしない。
// ファイル入力の寿命に追従し、プロジェクトを閉じた後にファイルを保持し続けない。
const resolvedMetadataCache = new WeakMap<object, TimelineClipMediaInfo>();

export function getTimelineClipMedia(asset: Asset): TimelineClipMediaInfo | Promise<TimelineClipMediaInfo> {
	return resolvedMetadataCache.get(asset.fileData) ?? inspectTimelineClipMedia(asset);
}

const metadataCache = new WeakMap<object, Promise<TimelineClipMediaInfo>>();

export function inspectTimelineClipMedia(asset: Asset): Promise<TimelineClipMediaInfo> {
	const fileSource = asset.fileData;
	const cached = metadataCache.get(fileSource);
	if (cached) return cached;
	const pending = (async () => {
		if (asset.fileDataType.startsWith('video/')) {
			const { metadata, audioError } = await inspectVideoLayerAsset(fileSource);
			return { durationMs: metadata.durationMs, audioAvailable: metadata.audio != null && !audioError, audioError };
		}
		const audio = await openAssetAudio(asset);
		try {
			return { durationMs: audio.durationSeconds * 1000, audioAvailable: true, audioError: null };
		} finally { audio.dispose(); }
	})();
	metadataCache.set(fileSource, pending);
	void pending.then(info => { resolvedMetadataCache.set(fileSource, info); }, () => {});
	void pending.catch(() => { metadataCache.delete(fileSource); });
	return pending;
}
