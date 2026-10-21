import { genId } from '@gs/shared/utility/id.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { createTimelineClipTiming } from '@gs/subsystems_timeline_shared/timing.ts';
import { createTimelineMediaClipTiming } from '@gs/subsystems_timeline_shared/media-timing.ts';
import { timelineAudioParamDefs } from '@gs/subsystems_timeline_shared/timeline-audio.ts';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import type { Asset } from '@gs/shared/types.ts';
import type { TimelineImageLayer, TimelineVideoLayer, TimelineAudioLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipMediaInfo, TimelineClipSourceDurations } from './timeline-clip-media.ts';

export type TimelineAssetLayer = TimelineImageLayer | TimelineVideoLayer | TimelineAudioLayer;
export type TimelineAssetPlacement = { sceneId: string; layers: TimelineAssetLayer[]; sourceDurationsMs: TimelineClipSourceDurations };

export function getTimelineAssetLayerType(asset: Asset): 'image' | 'video' | 'audio' | null {
	if (asset.fileDataType.startsWith('image/')) return 'image';
	if (asset.fileDataType.startsWith('video/')) return 'video';
	if (asset.fileDataType.startsWith('audio/')) return 'audio';
	return null;
}

/** メニュー追加とドロップで同じ初期設定を使う。選択UIや素材の読み込みは呼び出し側が所有する。 */
export function createTimelineAssetLayer(asset: Asset, startMs: number, media: TimelineClipMediaInfo | null): TimelineAssetLayer | null {
	const layerType = getTimelineAssetLayerType(asset);
	if (layerType == null) return null;
	const durationMs = layerType === 'image' ? 5000 : media?.durationMs;
	if (durationMs == null || !Number.isFinite(durationMs) || durationMs < 1) throw new Error('Media has no usable duration.');
	const base = {
		id: genId(),
		name: asset.name,
		automationGraphs: [],
		isDisabled: false,
		color: null,
	};
	const clip = {
		id: genId(),
		assetId: asset.id,
		...createTimelineClipTiming(Math.max(0, startMs), durationMs),
	};
	const audioParamValues = {
		volume: deepClone(timelineAudioParamDefs.volume.defaultValue),
	};
	if (layerType === 'audio') return {
		...base,
		layerType,
		clips: [{
			id: clip.id,
			assetId: asset.id,
			...createTimelineMediaClipTiming(clip.startMs, durationMs),
		}],
		audioParamValues,
	};
	const visual = {
		mask: null,
		layerMask: null,
		isIncludedInComposite: true,
		coordinateSpace: 'screen' as const,
		forceDisableMotionBlur: false,
		compositingParamValues: deepClone(Object.fromEntries(Object.entries(timelineCompositingParamDefs)
			.map(([key, def]) => [key, def.defaultValue]))) as TimelineImageLayer['compositingParamValues'],
	};
	if (layerType === 'image') return {
		...base,
		...visual,
		layerType,
		clips: [clip],
	};
	return {
		...base,
		...visual,
		layerType,
		audioParamValues,
		clips: [{
			id: clip.id,
			assetId: asset.id,
			...createTimelineMediaClipTiming(clip.startMs, durationMs),
			audioEnabled: media?.audioAvailable === true,
			videoEnabled: true,
		}],
	};
}
