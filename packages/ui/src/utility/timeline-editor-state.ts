import type { TimelineLayer, TimelineScene } from '@glitch/shared/timeline/types.ts';

// 表示状態は保存・Undoの対象にせず、Sceneの定義が破棄されれば一緒に回収する。
export const sceneEditorStates = new WeakMap<TimelineScene, {
	selectedLayerId: string | null;
	rangeX: number;
	positionX: number;
}>();

export const timelineLayerClipboard: { layer: TimelineLayer | null } = { layer: null };
