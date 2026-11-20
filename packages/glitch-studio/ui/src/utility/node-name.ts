import { getEffectDefinitions } from './project-effects.ts';
import type { CustomNodeGraphEffectEffectNode } from '@/types/custom-node-graph-effect-view.ts';

export function getEffectNodeName(node: CustomNodeGraphEffectEffectNode, definitions = getEffectDefinitions({})): string {
	const effectName = definitions.describe(node.effectSource).displayName;
	return node.displayName ? `${effectName} (${node.displayName})` : effectName;
}
