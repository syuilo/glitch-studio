import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CustomNodeGraphEffectEffectNode, CustomNodeGraphEffectParameterBinding } from '@gs/subsystems_custom-node-graph-effect_shared/types.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
export type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

export type NodeParamTarget = { nodeId: CustomNodeGraphEffectEffectNode['id']; paramPath: ParamPath };

export function getNodeParamDefs(node: CustomNodeGraphEffectEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions): Record<string, ParameterDefinition> {
	return definitions[node.effectId].paramDefs as Record<string, ParameterDefinition>;
}

export function resolveNodeParam(node: CustomNodeGraphEffectEffectNode, path: ParamPath, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions) {
	return resolveParameter<CustomNodeGraphEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params, path);
}

export function walkNodeParams(node: CustomNodeGraphEffectEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions) {
	return walkParameters<CustomNodeGraphEffectParameterBinding>(getNodeParamDefs(node, definitions), node.params);
}
