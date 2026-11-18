import { getTimelineClipLayers } from './layer-tree.ts';
import type { TimelineScene } from './types.ts';
import type { CustomNodeGraphEffect } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

/** 配置された定義を検査する。未使用のCustom Node Graph EffectやCustom Node Graph Effect Live Previewだけの構成は対象にしない。 */
export function findTimelineHistoryEffects(scenes: readonly TimelineScene[], getCustomNodeGraphEffect: (id: string) => CustomNodeGraphEffect | null, definitions: Record<string, EffectDefinition>): string[] {
	const result = new Set<string>();
	const inspectEffect = (id: string) => {
		if (definitions[id]?.dependsOnRenderHistory) result.add(id);
	};
	for (const scene of scenes) for (const layer of getTimelineClipLayers(scene.layers)) {
		if (layer.clips.length === 0) continue;
		if (layer.layerType === 'effect') inspectEffect(layer.effectId);
		const customNodeGraphEffect = layer.layerType === 'inlineCustomNodeGraphEffect' ? layer.customNodeGraphEffect
			: layer.layerType === 'customNodeGraphEffect' ? getCustomNodeGraphEffect(layer.customNodeGraphEffectId) : null;
		if (customNodeGraphEffect) for (const node of customNodeGraphEffect.nodes) {
			if (node.type === 'effect') inspectEffect(node.effectId);
		}
	}
	return [...result];
}
