import { effectDefinitions } from '@glitch/shared/effect/effect-definitions.ts';
import { resolveParameter, walkParameters } from '@glitch/shared/parameter/parameter-path.ts';
import type { ParameterDefinition } from '@glitch/shared/parameter/parameter-definition.ts';
import type { VisualModuleEffectNode } from '@glitch/shared/visual-module/types.ts';
import type { ParamPath } from '@glitch/shared/parameter/parameter-path.ts';
export { paramPathKey } from '@glitch/shared/parameter/parameter-path.ts';
export type { ParamPath } from '@glitch/shared/parameter/parameter-path.ts';

export type NodeParamTarget = { nodeId: VisualModuleEffectNode['id']; paramPath: ParamPath };

export function getNodeParamDefs(node: VisualModuleEffectNode): Record<string, ParameterDefinition> {
	return effectDefinitions[node.effectId].paramDefs as Record<string, ParameterDefinition>;
}

export function resolveNodeParam(node: VisualModuleEffectNode, path: ParamPath) {
	return resolveParameter(getNodeParamDefs(node), node.params, path);
}

export function walkNodeParams(node: VisualModuleEffectNode) {
	return walkParameters(getNodeParamDefs(node), node.params);
}
