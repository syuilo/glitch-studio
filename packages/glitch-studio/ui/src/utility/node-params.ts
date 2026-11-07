import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
import { resolveParameter, walkParameters } from '@gs/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { VisualModuleEffectNode, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';
export { paramPathKey } from '@gs/shared/parameter/parameter-path.ts';
export type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

export type NodeParamTarget = { nodeId: VisualModuleEffectNode['id']; paramPath: ParamPath };

export function getNodeParamDefs(node: VisualModuleEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions): Record<string, ParameterDefinition> {
	return definitions[node.effectId].paramDefs as Record<string, ParameterDefinition>;
}

export function resolveNodeParam(node: VisualModuleEffectNode, path: ParamPath, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions) {
	return resolveParameter<VisualModuleParameterBinding>(getNodeParamDefs(node, definitions), node.params, path);
}

export function walkNodeParams(node: VisualModuleEffectNode, definitions: Readonly<Record<string, EffectDefinition>> = effectDefinitions) {
	return walkParameters<VisualModuleParameterBinding>(getNodeParamDefs(node, definitions), node.params);
}
