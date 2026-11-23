import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { NodesEffect, NodesEffectParameterBinding } from '@gs/subsystems_effect_shared/nodes-effect.ts';
import type { NodesEffectResources } from '@gs/glitch-studio_shared/nodes-effect-resources.ts';
import type { NodesEffectEditorMetadata } from '@gs/glitch-studio_shared/project/types.ts';

export type PortableNodesEffectRuntimeRequirements = {
	effectIds: string[];
	requiresExpressions: boolean;
	requiresCustomShaderEffects: boolean;
};

function usesExpressions(definitions: Readonly<Record<string, ParameterDefinition>>, bindings: Readonly<Record<string, NodesEffectParameterBinding>>) {
	// 省略された入力は末端までliteralの既定値なので、配置で指定されたBindingだけを調べる。
	for (const [key, binding] of Object.entries(bindings)) {
		for (const { param } of walkParameterLeaves<NodesEffectParameterBinding>({ value: definitions[key] }, { value: binding })) {
			if (isValueParameterBinding(param) && (param.inputSource === 'expression' || param.expressionModifier?.enabled === true)) return true;
		}
	}
	return false;
}

/**
 * 式から動的に参照されるCUSTOMの値も扱えるよう、スナップショットに含む全配置を調べる。
 * 同じ登録のNodes Effectの内部は一度で十分だが、各配置の入力は個別に調べる。
 */
export function analyzePortableNodesEffectRuntime(resources: NodesEffectResources, nativeDefinitions: Readonly<Record<string, NativeEffectDefinition>>) {
	const shaders = new Map(resources.customShaderEffects.map(entry => [entry.id, entry]));
	const nodesEffects = new Map(resources.nodesEffects.map(entry => [entry.id, entry]));
	const visited = new Set<NodesEffect>();
	const effectIds = new Set<string>();
	const resolutionNodes: string[] = [];
	let requiresExpressions = false;
	let requiresCustomShaderEffects = false;

	function visit(nodesEffect: NodesEffect, metadata?: NodesEffectEditorMetadata) {
		if (visited.has(nodesEffect)) return;
		visited.add(nodesEffect);
		requiresExpressions ||= usesExpressions(nodesEffect.customParameterDefs ?? {}, nodesEffect.customParameterValues ?? {});
		for (const node of nodesEffect.nodes) {
			if (node.type === 'relay') continue;
			const source = node.effectSource;
			const editor = metadata?.nodeMetadata?.[node.id];
			let definition;
			let name = node.id;
			switch (source.type) {
				case 'nativeEffect':
					effectIds.add(source.id);
					definition = nativeDefinitions[source.id];
					name = definition.displayName;
					break;
				case 'inlineCustomShaderEffect':
					requiresCustomShaderEffects = true;
					definition = source.customShaderEffect;
					break;
				case 'customShaderEffectReference': {
					requiresCustomShaderEffects = true;
					const entry = shaders.get(source.id)!;
					definition = entry.definition;
					name = entry.name;
					break;
				}
				case 'inlineNodesEffect':
					definition = source.nodesEffect;
					visit(definition, editor?.inlineNodesEffect);
					break;
				case 'nodesEffectReference': {
					const entry = nodesEffects.get(source.id)!;
					definition = entry.definition;
					name = entry.name;
					visit(definition, entry);
					break;
				}
			}
			requiresExpressions ||= usesExpressions(definition.paramDefs, node.params);
			const size = node.resolution;
			if (size == null ? definition.intrinsicResolutionSetting != null || definition.resolutionInputParameters.length > 0
				: !('mode' in size) || size.mode !== 'context' || size.scale !== 1) resolutionNodes.push(editor?.displayName || name);
		}
	}

	visit(resources.nodesEffect, resources);
	return { runtimeRequirements: { effectIds: [...effectIds].sort(), requiresExpressions, requiresCustomShaderEffects }, resolutionNodes };
}
