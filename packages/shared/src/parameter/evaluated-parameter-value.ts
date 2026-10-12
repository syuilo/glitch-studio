import { validateEnumParameterValue } from './parameter-definition.ts';
import { coerceParameterValue } from './coerce-parameter-value.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ParameterBindingBase } from './parameter-binding.ts';

/** 保存値・キー値は更新境界で検証済み。動的な結果に対する検証は引き続き評価後に行う。 */
export function requiresRuntimeValueValidation(binding: ParameterBindingBase): boolean {
	return binding.inputSource !== 'literal' && binding.inputSource !== 'keyframesTimelineInline';
}

export function resolveEvaluatedParameterValue(definition: ParameterDefinition, binding: ParameterBindingBase, value: unknown): unknown {
	if (requiresRuntimeValueValidation(binding)) return coerceParameterValue(definition, validateEnumParameterValue(definition, value));
	return definition.dataType.kind === 'scalar' && typeof value === 'string' ? Number(value) : value;
}
