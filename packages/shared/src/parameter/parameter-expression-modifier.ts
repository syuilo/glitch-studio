import { isValueParameterBinding } from './parameter-binding.ts';
import { deepClone } from '../utility/deep-clone.ts';
import type { ParameterBindingBase } from './parameter-binding.ts';
import type { ParameterDefinition } from './parameter-definition.ts';
import type { ValueParameterBinding } from './value-parameter-binding.ts';

export function supportsParameterExpressionModifier(definition: Pick<ParameterDefinition, 'dataType'>, binding: ParameterBindingBase): binding is ValueParameterBinding {
	return definition.dataType.kind !== 'array' && definition.dataType.kind !== 'struct' && definition.dataType.kind !== 'audioSource'
		&& isValueParameterBinding(binding);
}

/** 式の構文・実行エラーは描画時に扱い、静的検証では保存形式と適用可能な入力方式だけを検査する。 */
export function validateParameterExpressionModifier(definition: Pick<ParameterDefinition, 'dataType'>, binding: ParameterBindingBase): void {
	if (!('expressionModifier' in binding) || binding.expressionModifier == null) return;
	if (!supportsParameterExpressionModifier(definition, binding)) throw new Error('Expression modifiers require a CPU value leaf parameter');
	const modifier = binding.expressionModifier;
	if (typeof modifier !== 'object' || !('enabled' in modifier) || typeof modifier.enabled !== 'boolean'
		|| !('code' in modifier) || typeof modifier.code !== 'string') throw new Error('Invalid expression modifier');
}

/** 基準入力の編集では加工式を保持する。リセット・加工式そのものの編集では呼び出さない。 */
export function preserveParameterExpressionModifier<const Binding extends ParameterBindingBase>(current: ParameterBindingBase, next: Binding): Binding {
	if (!isValueParameterBinding(current) || !isValueParameterBinding(next) || current.expressionModifier == null) return next;
	return { ...next, expressionModifier: deepClone(current.expressionModifier) };
}
