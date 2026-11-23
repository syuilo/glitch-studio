import { getEffectDefinitions } from './project-effects.ts';
import type { NodesEffectEffectNode } from '@/types/nodes-effect-view.ts';

export function getEffectNodeName(node: NodesEffectEffectNode, definitions = getEffectDefinitions({})): string {
	const effectName = definitions.describe(node.effectSource).displayName;
	return node.displayName ? `${effectName} (${node.displayName})` : effectName;
}
