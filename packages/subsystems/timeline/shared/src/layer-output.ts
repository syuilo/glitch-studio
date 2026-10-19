import { isTimelineVisualLayer } from './types.ts';
import { findTimelineLayer } from './layer-tree.ts';
import type { TimelineLayer, TimelineVisualLayer } from './types.ts';
import type { TimelineAnotherLayerOutputBinding } from './parameter-binding.ts';

export type TimelineImageInputReference = { inputSource: 'lowerLayerOutput' } | TimelineAnotherLayerOutputBinding;

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
			if (layer.layerType === 'transform') {
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
			graph.set(key(layer.id, 'rendered'), [source]);
			const composited = key(layer.id, 'composited');
			graph.set(composited, lower == null ? [source] : [lower, source]);
			lower = composited;
		}
		return lower;
	};
	visit(layers, null);
	return graph;
}
