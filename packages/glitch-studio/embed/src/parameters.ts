import type { CustomNodeGraphEffect } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** 配布先のAPIとPUBLIC式が、同じ参照名で公開値を引けるようにする。 */
export function getPortableParameterDefinitions(graph: CustomNodeGraphEffect): ReadonlyMap<string, ParameterDefinition> {
	return new Map(Object.entries(graph.paramDefs).map(([id, def]) => [def.nameForReference ?? id, def]));
}

export function getPortableParameterDefaults(definitions: ReadonlyMap<string, ParameterDefinition>): Record<string, unknown> {
	return Object.fromEntries(Array.from(definitions, ([name, definition]) => [name, structuredClone(definition.defaultValue)]));
}
