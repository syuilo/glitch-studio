import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { isLiteralParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { preserveParameterExpressionModifier } from '@gs/shared/parameter/parameter-expression-modifier.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';

export type StructParameterFieldBindings = Record<string, Extract<ValueParameterBinding, { inputSource: 'literal' | 'keyframesTimelineInline' }>>;

/** 複数フィールドを先に組み立て、中心だけ・倍率だけが通知される中間状態を作らない。 */
export function updateStructParameterFields<Binding extends ParameterBindingBase>(definition: ParameterDefinition, current: Binding,
	fields: StructParameterFieldBindings): Binding {
	if (!isParameterType(definition, 'struct') || !isLiteralParameterBinding(current)) throw new Error('Expected a literal struct parameter');
	const definitions = getStructFieldDefinitions(definition);
	const next = deepClone(current);
	for (const [key, binding] of Object.entries(fields)) {
		const field = definitions[key];
		const previous = next.value[key] as ParameterBindingBase | null;
		if (field == null || previous == null || field.dataType.kind === 'struct' || field.dataType.kind === 'array') throw new Error('Expected a leaf struct field');
		// プレビュー編集は入力方式を切り替えない。古い操作から式や参照を固定値へ戻さない。
		if (previous.inputSource !== binding.inputSource) throw new Error('Struct field input source changed');
		next.value[key] = preserveParameterExpressionModifier(previous, deepClone(binding));
	}
	return next;
}
