import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';
import { getActiveDragData } from '../utility/drag-and-drop.ts';

export function useTimelineAssetDrop(options: {
	target: Readonly<Ref<HTMLElement | null>>;
	dropFiles: (files: readonly File[]) => Promise<void>;
	dropAsset: (assetId: string) => Promise<void>;
	reportError: (error: unknown) => void;
}) {
	const hovering = ref(false);
	let depth = 0;
	let busy = false;
	let windowTarget: Window | null = null;
	const accepts = (event: DragEvent) => event.dataTransfer != null
		&& (event.dataTransfer.types.includes('Files') || getActiveDragData(event, 'GsAsset') != null);

	function clear() { depth = 0; hovering.value = false; }

	function accept(event: DragEvent) {
		if (!accepts(event)) return false;
		event.preventDefault();
		// Appの通常バブリングと、レイヤー行の並び替え処理の両方へ渡さない。
		event.stopPropagation();
		if (event.dataTransfer != null) event.dataTransfer.dropEffect = 'copy';
		return true;
	}

	function onDragenter(event: DragEvent) {
		if (!accept(event)) return;
		depth++;
		hovering.value = true;
	}

	function onDragover(event: DragEvent) {
		if (!accept(event)) return;
		hovering.value = true;
	}

	function onDragleave(event: DragEvent) {
		if (!accept(event)) return;
		// 子要素間を移動する際にもenter/leaveが発生するので、最後のleaveだけで表示を消す。
		depth = Math.max(0, depth - 1);
		if (depth === 0) hovering.value = false;
	}

	async function onDrop(event: DragEvent) {
		if (!accept(event)) return;
		clear();
		if (busy) return;
		busy = true;
		try {
			const data = getActiveDragData(event, 'GsAsset');
			if (data != null) await options.dropAsset(data.assetId);
			else await options.dropFiles(Array.from(event.dataTransfer?.files ?? []));
		} catch (error) { options.reportError(error); } finally { busy = false; }
	}

	onMounted(() => {
		windowTarget = options.target.value?.ownerDocument?.defaultView ?? null;
		windowTarget?.addEventListener('dragend', clear, true);
		windowTarget?.addEventListener('drop', clear, true);
		windowTarget?.addEventListener('blur', clear);
	});
	onBeforeUnmount(() => {
		windowTarget?.removeEventListener('dragend', clear, true);
		windowTarget?.removeEventListener('drop', clear, true);
		windowTarget?.removeEventListener('blur', clear);
		clear();
	});
	return { hovering, onDragenter, onDragover, onDragleave, onDrop };
}
