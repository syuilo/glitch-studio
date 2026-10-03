import type { TimelineLayer, TimelineScene } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineSelection } from './timeline-selection.ts';

// 表示状態は保存・Undoの対象にせず、Sceneの定義が破棄されれば一緒に回収する。
export const sceneEditorStates = new WeakMap<TimelineScene, {
	selection: TimelineSelection;
	rangeX: number;
	positionX: number;
}>();

export const timelineLayerClipboard: { layer: TimelineLayer | null } = { layer: null };
