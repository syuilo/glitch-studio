import { getTimelineClipLayers } from './layer-tree.ts';
import type { TimelineScene } from './types.ts';
import type { VisualModule } from '@gs/subsystems_visual-module_shared/types.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';

/** 配置された定義を検査する。未使用のVisual ModuleやLIVEだけの構成は対象にしない。 */
export function findTimelineHistoryEffects(scenes: readonly TimelineScene[], getVisualModule: (id: string) => VisualModule | undefined, definitions: Record<string, EffectDefinition>): string[] {
	const result = new Set<string>();
	const inspectEffect = (id: string) => {
		if (definitions[id]?.dependsOnRenderHistory) result.add(id);
	};
	for (const scene of scenes) for (const layer of getTimelineClipLayers(scene.layers)) {
		if (layer.clips.length === 0) continue;
		if (layer.layerType === 'effect') inspectEffect(layer.effectId);
		const visualModule = layer.layerType === 'inlineVisualModule' ? layer.visualModule
			: layer.layerType === 'visualModule' ? getVisualModule(layer.visualModuleId) : undefined;
		if (visualModule) for (const node of visualModule.nodes) {
			if (node.type === 'effect') inspectEffect(node.effectId);
		}
	}
	return [...result];
}
