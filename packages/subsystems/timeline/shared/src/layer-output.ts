import { isTimelineVisualLayer, isTimelineNonCompositingContainerLayer } from './types.ts';
import { findTimelineLayer, findTimelineLayerLocation, flattenTimelineLayers } from './layer-tree.ts';
import type { TimelineLayer, TimelineVisualLayer } from './types.ts';
import type { TimelineAnotherLayerOutputBinding } from './parameter-binding.ts';

export type TimelineImageInputReference = { inputSource: 'lowerLayerOutput' } | TimelineAnotherLayerOutputBinding;

/** Group以外のコンテナは境界を作らない。Group自身は外側、子孫はGroup内の合成空間に属する。 */
export function getTimelineLayerMaskSources(layers: TimelineLayer[], ownerLayerId: string): TimelineVisualLayer[] {
	const owner = findTimelineLayerLocation(layers, ownerLayerId);
	if (owner == null || !isTimelineVisualLayer(owner.layer)) return [];
	const boundary = owner.ancestors.findLast(layer => layer.layerType === 'group');
	const visit = (entries: readonly TimelineLayer[]): TimelineVisualLayer[] => entries.flatMap(layer => [
		...(layer.id !== ownerLayerId && isTimelineVisualLayer(layer) ? [layer] : []),
		...(isTimelineNonCompositingContainerLayer(layer) ? visit(layer.layers) : []),
	]);
	return visit(boundary?.layers ?? layers);
}

export function validateTimelineLayerMaskReferences(layers: TimelineLayer[]): void {
	for (const layer of flattenTimelineLayers(layers)) {
		if (!isTimelineVisualLayer(layer) || layer.layerMask == null) continue;
		const source = findTimelineLayer(layers, layer.layerMask.sourceLayerId);
		// 削除されたIDは保持する。Undoで復旧でき、取得時は透明黒になる。
		if (source == null) continue;
		if (!getTimelineLayerMaskSources(layers, layer.id).some(candidate => candidate.id === source.id)) throw new Error('Layer mask source must be another visual layer in the same compositing boundary');
	}
}

export function resolveTimelineImageLayerReference(layers: readonly TimelineLayer[], ownerLayerId: string, layerId: string | null): TimelineVisualLayer | null {
	if (layerId == null || layerId === ownerLayerId) return null;
	const layer = findTimelineLayer(layers, layerId);
	return layer != null && isTimelineVisualLayer(layer) ? layer : null;
}

/**
 * 素材と合成途中の画像を別の頂点にする。単にレイヤー順を依存辺にすると、下層入力を
 * 使わない上層の素材まで下層へ依存し、成立する参照も循環と判定してしまう。
 * 無効化・クリップ期間では辺を除かず、編集後や別時刻にも成立する配線だけを許可する。
 */
export function getTimelineLayerOutputDependencyGraph(layers: readonly TimelineLayer[], getInputs: (layerId: string) => readonly TimelineImageInputReference[]): Map<string, readonly string[]> {
	const graph = new Map<string, readonly string[]>();
	const key = (id: string, stage: string) => JSON.stringify([id, stage]);
	const visit = (entries: readonly TimelineLayer[], initial: string | null): string | null => {
		let lower = initial;
		for (const layer of entries.toReversed()) {
			if (isTimelineNonCompositingContainerLayer(layer)) {
				lower = visit(layer.layers, lower);
				continue;
			}
			if (!isTimelineVisualLayer(layer)) continue;
			const source = key(layer.id, 'source');
			const dependencies: string[] = [];
			if (layer.layerType === 'group') {
				const children = visit(layer.layers, null);
				if (children != null) dependencies.push(children);
			}
			for (const input of getInputs(layer.id)) {
				if (input.inputSource === 'lowerLayerOutput') {
					if (lower != null) dependencies.push(lower);
				} else if (input.layerId != null) {
					const target = findTimelineLayer(layers, input.layerId);
					if (target != null && isTimelineVisualLayer(target)) dependencies.push(key(target.id, input.outputStage));
				}
			}
			graph.set(source, dependencies);
			const renderedDependencies = [source];
			if (layer.layerMask != null) {
				const target = findTimelineLayer(layers, layer.layerMask.sourceLayerId);
				if (target != null && isTimelineVisualLayer(target)) renderedDependencies.push(key(target.id, 'rendered'));
			}
			graph.set(key(layer.id, 'rendered'), renderedDependencies);
			const composited = key(layer.id, 'composited');
			graph.set(composited, [...(lower == null ? [] : [lower]), ...(layer.isIncludedInComposite === false ? [] : renderedDependencies)]);
			lower = composited;
		}
		return lower;
	};
	visit(layers, null);
	return graph;
}
