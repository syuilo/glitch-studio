import { getEffectDefinitions } from './project-effects.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectParameterBinding } from '@/types/custom-node-graph-effect-view.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
export type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

export type NodeParamTarget = { nodeId: CustomNodeGraphEffectEffectNode['id']; paramPath: ParamPath };

export function getNodeParamDefs(node: CustomNodeGraphEffectEffectNode, definitions = getEffectDefinitions({})): Record<string, ParameterDefinition> {
	return definitions.describe(node.effectSource).paramDefs as Record<string, ParameterDefinition>;
}

export function resolveNodeParam(node: CustomNodeGraphEffectEffectNode, path: ParamPath, definitions = getEffectDefinitions({})) {
	return resolveParameter<CustomNodeGraphEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params, path);
}

export function walkNodeParams(node: CustomNodeGraphEffectEffectNode, definitions = getEffectDefinitions({})) {
	return walkParameters<CustomNodeGraphEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params);
}
