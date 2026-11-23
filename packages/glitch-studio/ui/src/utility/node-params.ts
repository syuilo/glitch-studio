import { getEffectDefinitions } from './project-effects.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NodesEffectEffectNode, NodesEffectParameterBinding } from '@/types/nodes-effect-view.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
export type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

export type NodeParamTarget = { nodeId: NodesEffectEffectNode['id']; paramPath: ParamPath };

export function getNodeParamDefs(node: NodesEffectEffectNode, definitions = getEffectDefinitions({})): Record<string, ParameterDefinition> {
	return definitions.describe(node.effectSource).paramDefs as Record<string, ParameterDefinition>;
}

export function resolveNodeParam(node: NodesEffectEffectNode, path: ParamPath, definitions = getEffectDefinitions({})) {
	return resolveParameter<NodesEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params, path);
}

export function walkNodeParams(node: NodesEffectEffectNode, definitions = getEffectDefinitions({})) {
	return walkParameters<NodesEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params);
}
