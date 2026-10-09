import { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import { validateTimelineClips } from '@gs/subsystems_timeline_shared/timing.ts';
import type { TimelineClip, TimelineAssetClip, TimelineVideoClip, TimelineSceneClip } from '@gs/subsystems_timeline_shared/clip.ts';
import type { TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineClipSelection } from './timeline-selection.ts';

export type TimelineClipPaste = {
	layerId: string;
	clip: TimelineClip | TimelineAssetClip | TimelineVideoClip | TimelineSceneClip;
};

export type TimelineClipClipboard = {
	kind: 'clips';
	scene: TimelineScene;
	clips: TimelineClipPaste[];
};

export function copyTimelineClips(scene: TimelineScene, selection: readonly TimelineClipSelection[]): TimelineClipClipboard | null {
	if (selection.length === 0) return null;
	const clips: TimelineClipPaste[] = [];
	for (const target of selection) {
		const layer = findTimelineLayer(scene.layers, target.layerId);
		const clip = layer && layer.layerType !== 'group' ? layer.clips.find(clip => clip.id === target.clipId) : undefined;
		if (!clip) return null;
		clips.push({ layerId: target.layerId, clip: deepClone(clip) });
	}
	// Sceneの同一性も保持し、別Sceneや読み込み後の同名IDのレイヤーへ貼り付けない。
	return { kind: 'clips', scene, clips };
}

export function canPasteTimelineClips(scene: TimelineScene, clips: readonly TimelineClipPaste[]): boolean {
	if (clips.length === 0) return false;
	for (const layerId of new Set(clips.map(entry => entry.layerId))) {
		const layer = findTimelineLayer(scene.layers, layerId);
		if (!layer || layer.layerType === 'group') return false;
		try {
			validateTimelineClips([...layer.clips, ...clips.filter(entry => entry.layerId === layerId).map(entry => entry.clip)]);
		} catch { return false; }
	}
	return true;
}

export function prepareTimelineClipPaste(scene: TimelineScene, clipboard: TimelineClipClipboard, timeMs: number): TimelineClipPaste[] | null {
	if (scene !== clipboard.scene || clipboard.clips.length === 0 || !Number.isFinite(timeMs)) return null;
	const startMs = Math.round(timeMs);
	const firstStartMs = Math.min(...clipboard.clips.map(entry => entry.clip.startMs));
	// 全クリップを共通量だけずらし、間隔・トリム済みの内容オフセット・素材設定を維持する。
	const clips = clipboard.clips.map(entry => ({ layerId: entry.layerId,
		clip: { ...deepClone(entry.clip), id: genId(), startMs: startMs + (entry.clip.startMs - firstStartMs) },
	}));
	return canPasteTimelineClips(scene, clips) ? clips : null;
}
