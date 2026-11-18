import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import type { CustomNodeGraphEffectEffectNode } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';

export function getEffectNodeName(node: CustomNodeGraphEffectEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions): string {
	const effectName = definitions[node.effectId]?.displayName ?? node.effectId;
	return node.displayName ? `${effectName} (${node.displayName})` : effectName;
}
