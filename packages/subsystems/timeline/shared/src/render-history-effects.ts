import { resolveEffectSource, type EffectSource, type EffectDefinitions } from '@gs/subsystems_effect_shared/effect-source.ts';
import { getTimelineClipLayers } from './layer-tree.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { TimelineScene } from './types.ts';

/**
 * Timelineで描画履歴に依存するNative Effectを検出するため、クリップのあるEffectレイヤーからたどる。
 * 同じCustom Node Graph Effectを複数箇所で参照しても検査は一度でよい。
 */
export function findTimelineHistoryEffects(scenes: readonly TimelineScene[], definitions: EffectDefinitions): string[] {
	const result = new Set<string>();
	const visited = new Set<CustomNodeGraphEffect>();

	function inspect(source: EffectSource): void {
		const effect = resolveEffectSource(source, definitions);
		if (effect.type === 'nativeEffect' && effect.definition.dependsOnRenderHistory === true) result.add(effect.id);
		if (effect.type !== 'customNodeGraphEffect' || visited.has(effect.definition)) return;
		visited.add(effect.definition);
		for (const node of effect.definition.nodes) {
			if (node.type !== 'relay' && node.isBypass !== true) inspect(node.effectSource);
		}
	}

	for (const scene of scenes) for (const layer of getTimelineClipLayers(scene.layers)) {
		if (layer.layerType === 'effect' && layer.clips.length > 0) inspect(layer.effectSource);
	}
	return [...result];
}
