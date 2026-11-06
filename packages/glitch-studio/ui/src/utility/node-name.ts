import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import type { VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';

export function getEffectNodeName(node: VisualModuleEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions): string {
	const effectName = definitions[node.effectId]?.displayName ?? node.effectId;
	return node.displayName ? `${effectName} (${node.displayName})` : effectName;
}
