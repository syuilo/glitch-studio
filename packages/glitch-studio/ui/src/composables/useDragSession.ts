import { computed, onBeforeUnmount } from 'vue';
import { genId } from '@gs/shared/utility/id.ts';
import { startDragSession, getActiveDragData, getDragSessionData, finishDragSession, completeDragSession } from '../utility/drag-and-drop.ts';
import type { DragDataMap } from '../utility/drag-and-drop.ts';

/** 開始元の寿命と識別を所有し、ドラッグ中の値と終了処理は共通セッションへ委ねる。 */
export function useDragSession() {
	const sourceId = genId();
	const finish = () => finishDragSession(sourceId);
	onBeforeUnmount(finish);
	return {
		sourceId,
		start: <T extends keyof DragDataMap>(event: DragEvent, type: T, data: DragDataMap[T], onDrop: (() => void) | null = null) => startDragSession(event, sourceId, type, data, onDrop),
		read: <T extends keyof DragDataMap>(event: DragEvent, type: T) => getActiveDragData(event, type),
		readSource: <T extends keyof DragDataMap>(event: DragEvent, type: T) => getActiveDragData(event, type, sourceId),
		data: <T extends keyof DragDataMap>(type: T) => computed(() => getDragSessionData(type)),
		sourceData: <T extends keyof DragDataMap>(type: T) => computed(() => getDragSessionData(type, sourceId)),
		complete: (event: DragEvent) => completeDragSession(event, sourceId),
		finish,
	};
}
