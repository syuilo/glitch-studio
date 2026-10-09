import type { TimelineClipLayer, TimelineGroupLayer, TimelineLayer } from './types.ts';

/** Scene参照は辿らず、同じSceneが所有するレイヤーだけを表示順に列挙する。 */
export function flattenTimelineLayers(layers: readonly TimelineLayer[]): TimelineLayer[] {
	return layers.flatMap(layer => layer.layerType === 'group' ? [layer, ...flattenTimelineLayers(layer.layers)] : [layer]);
}

export function getTimelineClipLayers(layers: readonly TimelineLayer[]): TimelineClipLayer[] {
	return flattenTimelineLayers(layers).filter((layer): layer is TimelineClipLayer => layer.layerType !== 'group');
}

/** 親の情報は探索結果に付加し、子レイヤーの保存データには重複して持たせない。 */
export function findTimelineLayerLocation(layers: TimelineLayer[], id: string, ancestors: TimelineGroupLayer[] = []): {
	layer: TimelineLayer; siblings: TimelineLayer[]; index: number; ancestors: TimelineGroupLayer[];
} | undefined {
	for (const [index, layer] of layers.entries()) {
		if (layer.id === id) return { layer, siblings: layers, index, ancestors };
		if (layer.layerType === 'group') {
			const found = findTimelineLayerLocation(layer.layers, id, [...ancestors, layer]);
			if (found) return found;
		}
	}
	return undefined;
}

export function findTimelineLayer(layers: readonly TimelineLayer[], id: string): TimelineLayer | undefined {
	for (const layer of layers) {
		if (layer.id === id) return layer;
		if (layer.layerType === 'group') {
			const found = findTimelineLayer(layer.layers, id);
			if (found) return found;
		}
	}
	return undefined;
}

/** 無効なグループの子孫は評価しない。期間・保存・編集の走査とは区別する。 */
export function getEnabledTimelineLayers(layers: readonly TimelineLayer[]): TimelineLayer[] {
	return layers.flatMap(layer => layer.isDisabled ? [] : layer.layerType === 'group' ? [layer, ...getEnabledTimelineLayers(layer.layers)] : [layer]);
}

/** Workerへの差分適用用。変更経路だけをコピーし、評価中の旧ツリーは変更しない。 */
export function updateTimelineLayer(layers: readonly TimelineLayer[], id: string, update: (layer: TimelineLayer) => TimelineLayer | null): TimelineLayer[] {
	return layers.flatMap(layer => {
		if (layer.id === id) {
			const next = update(layer);
			return next ? [next] : [];
		}
		return [layer.layerType === 'group' && findTimelineLayer(layer.layers, id)
			? { ...layer, layers: updateTimelineLayer(layer.layers, id, update) } : layer];
	});
}
