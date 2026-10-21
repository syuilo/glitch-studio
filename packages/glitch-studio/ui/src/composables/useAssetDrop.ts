import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { Ref } from 'vue';
import { getActiveDragData } from '../utility/drag-and-drop.ts';
import { createDropTargetHandlers } from '../utility/drop-target.ts';

type AssetDropData = { kind: 'asset'; assetId: string } | { kind: 'files'; files: File[] };

export function useAssetDrop(options: {
	enabled?: () => boolean;
	target: Readonly<Ref<HTMLElement | null>>;
	dropFiles: (files: readonly File[]) => Promise<void>;
	dropAsset: (assetId: string) => Promise<void>;
	reportError: (error: unknown) => void;
}) {
	const hovering = ref(false);
	const handlers = createDropTargetHandlers<AssetDropData>({
		target: () => options.target.value,
		enabled: options.enabled,
		accepts: event => event.dataTransfer?.types.includes('Files') === true || getActiveDragData(event, 'GsAsset') != null,
		readDropData: event => {
			const asset = getActiveDragData(event, 'GsAsset');
			if (asset != null) return { kind: 'asset', assetId: asset.assetId };
			const files = Array.from(event.dataTransfer?.files ?? []);
			return files.length > 0 ? { kind: 'files', files } : null;
		},
		onDrop: data => data.kind === 'asset' ? options.dropAsset(data.assetId) : options.dropFiles(data.files),
		onError: options.reportError,
		onHoverChange: value => { hovering.value = value; },
	});
	onMounted(handlers.observeWindow);
	onBeforeUnmount(handlers.dispose);
	return {
		hovering,
		onDragenter: handlers.onDragenter,
		onDragover: handlers.onDragover,
		onDragleave: handlers.onDragleave,
		onDrop: handlers.onDrop,
	};
}
