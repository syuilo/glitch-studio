import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import type { VisualModuleEffectNode } from '@gs/subsystems_visual-module_shared/types.ts';

export function getEffectNodeName(node: VisualModuleEffectNode): string {
	const effectName = effectDefinitions[node.effectId].displayName;
	return node.displayName ? `${effectName} (${node.displayName})` : effectName;
}
