import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineSelection } from './timeline-selection.ts';
import type { TimelineClipClipboard } from './timeline-clip-clipboard.ts';
import type { TimelineKeyframeClipboard } from './timeline-keyframe-clipboard.ts';
import { shallowReactive } from 'vue';

// 表示状態は保存・Undoの対象にせず、Sceneの定義が破棄されれば一緒に回収する。
export const sceneEditorStates = new WeakMap<TimelineScene, {
	selection: TimelineSelection;
	layerSelectionAnchorId: string | null;
	rangeX: number;
	positionX: number;
}>();

export function getTimelineEditorState(scene: TimelineScene) {
	let state = sceneEditorStates.get(scene);
	if (state == null) {
		state = shallowReactive({ selection: { kind: 'layers', ids: [] } as TimelineSelection, layerSelectionAnchorId: null as string | null, rangeX: 30000, positionX: -3000 });
		sceneEditorStates.set(scene, state);
	}
	return state;
}

/** クリップ・キーを複数選択しても、所属が一つなら同じレイヤーを操作する。 */
export function getSelectedTimelineLayerId(selection: TimelineSelection): string | null {
	const ids = new Set(selection.kind === 'layers' ? selection.ids
		: selection.kind === 'clips' ? selection.clips.map(clip => clip.layerId) : selection.keyframes.map(keyframe => keyframe.layerId));
	return ids.size === 1 ? [...ids][0] : null;
}

export const timelineClipboard: { value: { kind: 'layer'; layer: TimelineLayer } | TimelineClipClipboard | TimelineKeyframeClipboard | null } = { value: null };
