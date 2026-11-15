import { walkParameterLeaves } from '@gs/shared/parameter/parameter-tree.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { isCustomShaderEffectReference } from '@gs/subsystems_effect_shared/custom-shader-effect.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '@gs/subsystems_effect_shared/effect-definition.ts';
import type { VisualModule, VisualModuleParameterBinding } from '@gs/subsystems_visual-module_shared/types.ts';

export type PortableVisualModuleRuntimeRequirements = {
	effectIds: string[];
	requiresExpressions: boolean;
	requiresParameterDefaultExpressions: boolean;
	requiresCustomShaderEffects: boolean;
};

function usesExpressions(definitions: Record<string, ParameterDefinition>, bindings: Record<string, VisualModuleParameterBinding>): boolean {
	for (const { def, param } of walkParameterLeaves<VisualModuleParameterBinding>(definitions, bindings)) {
		// 音声入力は配布先で未接続にする。通常の値と同様に式で読み替えることはない。
		if (def.dataType.kind === 'audioSource' || !isValueParameterBinding(param)) continue;
		if (param.inputSource === 'expression' || param.expressionModifier?.enabled === true) return true;
	}
	return false;
}

/** 検証済みのスナップショットを解析する。ノードや動的なCUSTOM参照を推測で削除しない。 */
export function analyzePortableVisualModuleRuntime(visualModule: VisualModule, definitions: Readonly<Record<string, EffectDefinition>>): PortableVisualModuleRuntimeRequirements {
	const effectIds = new Set<string>();
	let requiresExpressions = false;
	let requiresCustomShaderEffects = false;
	for (const node of visualModule.nodes) {
		if (node.type !== 'effect') continue;
		if (isCustomShaderEffectReference(node.effectId)) requiresCustomShaderEffects = true;
		else effectIds.add(node.effectId);
		requiresExpressions ||= usesExpressions(definitions[node.effectId].paramDefs, node.params);
	}
	for (const definition of visualModule.customParameterDefs) {
		requiresExpressions ||= usesExpressions({ value: definition }, { value: visualModule.customParameterValues[definition.id] ?? definition.defaultValue });
	}
	const requiresParameterDefaultExpressions = visualModule.paramDefs.some(definition => usesExpressions({ value: definition }, { value: definition.defaultValue }));
	return { effectIds: [...effectIds].sort(), requiresExpressions, requiresParameterDefaultExpressions, requiresCustomShaderEffects };
}
