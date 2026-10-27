import { isTimelineContainerLayer, isTimelineRenderLayer } from './types.ts';
import type { TimelineClipLayer, TimelineContainerLayer, TimelineLayer, TimelineVisualLayer, TimelineTransformLayer } from './types.ts';

/**
 * 整理用コンテナは描画列へ展開する。レンダラーの境界を増やさないため、フォルダへ
 * まとめるだけで既存の子の履歴・GPUリソースが破棄されることもない。
 * 参照スコープは保存ツリーから別途作り、ここでは描画順と一括無効化だけを扱う。
 */
export function getTimelineRenderLayers(layers: readonly TimelineLayer[]): (TimelineVisualLayer | TimelineTransformLayer)[] {
	const renderLayers: (TimelineVisualLayer | TimelineTransformLayer)[] = [];
	// 入れ子ごとに子孫の配列を作り直さず、表示順で一つの結果配列へ追加する。
	const visit = (layers: readonly TimelineLayer[]) => {
		for (const layer of layers) {
			if (layer.layerType === 'folder' || layer.layerType === 'parameterContainer') {
				if (!layer.isDisabled) visit(layer.layers);
			} else if (isTimelineRenderLayer(layer)) renderLayers.push(layer);
		}
	};
	visit(layers);
	return renderLayers;
}

/** Scene参照は辿らず、同じSceneが所有するレイヤーだけを表示順に列挙する。 */
export function flattenTimelineLayers(layers: readonly TimelineLayer[]): TimelineLayer[] {
	return layers.flatMap(layer => isTimelineContainerLayer(layer) ? [layer, ...flattenTimelineLayers(layer.layers)] : [layer]);
}

export function getTimelineClipLayers(layers: readonly TimelineLayer[]): TimelineClipLayer[] {
	return flattenTimelineLayers(layers).filter((layer): layer is TimelineClipLayer => !isTimelineContainerLayer(layer));
}

/** 親の情報は探索結果に付加し、子レイヤーの保存データには重複して持たせない。 */
export function findTimelineLayerLocation(layers: TimelineLayer[], id: string, ancestors: TimelineContainerLayer[] = []): {
	layer: TimelineLayer; siblings: TimelineLayer[]; index: number; ancestors: TimelineContainerLayer[];
} | null {
	for (const [index, layer] of layers.entries()) {
		if (layer.id === id) return {
			layer,
			siblings: layers,
			index,
			ancestors,
		};
		if (isTimelineContainerLayer(layer)) {
			const found = findTimelineLayerLocation(layer.layers, id, [...ancestors, layer]);
			if (found) return found;
		}
	}
	return null;
}

export function findTimelineLayer(layers: readonly TimelineLayer[], id: string): TimelineLayer | null {
	for (const layer of layers) {
		if (layer.id === id) return layer;
		if (isTimelineContainerLayer(layer)) {
			const found = findTimelineLayer(layer.layers, id);
			if (found) return found;
		}
	}
	return null;
}

/** 無効なコンテナの子孫は評価しない。期間・保存・編集の走査とは区別する。 */
export function getEnabledTimelineLayers(layers: readonly TimelineLayer[]): TimelineLayer[] {
	return layers.flatMap(layer => layer.isDisabled ? [] : isTimelineContainerLayer(layer) ? [layer, ...getEnabledTimelineLayers(layer.layers)] : [layer]);
}

/** Workerへの差分適用用。変更経路だけをコピーし、評価中の旧ツリーは変更しない。 */
export function updateTimelineLayer(layers: readonly TimelineLayer[], id: string, update: (layer: TimelineLayer) => TimelineLayer | null): TimelineLayer[] {
	return layers.flatMap(layer => {
		if (layer.id === id) {
			const next = update(layer);
			return next ? [next] : [];
		}
		return [isTimelineContainerLayer(layer) && findTimelineLayer(layer.layers, id)
			? { ...layer, layers: updateTimelineLayer(layer.layers, id, update) } : layer];
	});
}
