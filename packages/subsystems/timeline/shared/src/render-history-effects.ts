import { getTimelineClipLayers } from './layer-tree.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import type { CustomNodeGraphEffect, EffectReference, EffectSource } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { TimelineScene } from './types.ts';

type LeafEffectReference = Exclude<EffectReference, { type: 'customNodeGraphEffectReference' }>;

/** クリップを持つ配置から到達する実装だけを検査する。各実装が描画履歴を使うかどうかは呼び出し側から受け取る。 */
export function findTimelineHistoryEffects(scenes: readonly TimelineScene[], catalog: EffectCatalog,
	dependsOnRenderHistory: (reference: LeafEffectReference) => boolean): LeafEffectReference[] {
	const result: LeafEffectReference[] = [];
	const visitedGraphs = new Set<CustomNodeGraphEffect>();
	const visitedLeaves = new Set<string>();

	function visit(source: EffectSource): void {
		if (source.type === 'customNodeGraphEffectReference' || source.type === 'inlineCustomNodeGraphEffect') {
			const graph = catalog.getCustomNodeGraphEffect(source);
			if (visitedGraphs.has(graph)) return;
			visitedGraphs.add(graph);
			for (const node of graph.nodes) visit(node.effect);
		} else {
			// Native Effect と Custom Shader Effect は同じIDを持てる。
			const key = `${source.type}:${source.id}`;
			if (visitedLeaves.has(key)) return;
			visitedLeaves.add(key);
			if (dependsOnRenderHistory(source)) result.push(source);
		}
	}

	for (const scene of scenes) {
		for (const layer of getTimelineClipLayers(scene.layers)) {
			if (layer.layerType === 'effect' && layer.clips.length > 0) visit(layer.effect);
		}
	}
	return result;
}
