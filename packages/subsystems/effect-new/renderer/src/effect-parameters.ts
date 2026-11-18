import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, isParameterType } from '@gs/shared/parameter/parameter-definition.ts';
import { mapParameterTree } from '@gs/shared/parameter/parameter-tree.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectRenderRequest } from './effect-render-instance.ts';

/** 保存色だけをここでpremultiplyする。接続から届いた値は既に作業色空間の値である。 */
function resolveLeaf(definition: ParameterDefinition, value: unknown): unknown {
	if (definition.dataType.kind === 'audioSource') return value;
	if (definition.canNode === true && typeof value === 'object' && value != null && 'kind' in value) {
		if (value.kind === 'uniform' && 'value' in value && Array.isArray(value.value) && value.value.length >= 1 && value.value.length <= 4
			&& value.value.every(component => typeof component === 'number' && Number.isFinite(component))) return value;
		if (value.kind === 'texture' && 'texture' in value && value.texture != null
			&& 'fitMode' in value && (value.fitMode === 'stretch' || value.fitMode === 'contain' || value.fitMode === 'cover')
			&& 'wrapMode' in value && (value.wrapMode === 'clamp' || value.wrapMode === 'repeat' || value.wrapMode === 'repeatMirrored' || value.wrapMode === 'transparent')
			&& 'filterMode' in value && (value.filterMode === 'nearest' || value.filterMode === 'linear')) return value;
		throw new Error(`Invalid shader input for ${definition.ui.label}`);
	}
	const prepared = prepareExpressionParameterValue(definition, value);
	if (definition.dataType.kind === 'any' && prepared != null && (!Array.isArray(prepared) || prepared.length !== 4)) {
		throw new Error(`Expected four components for ${definition.ui.label}`);
	}
	return definition.canNode === true ? constantShaderInput(definition.dataType.kind, prepared) : prepared;
}

export function resolveEffectParameterValue(definition: ParameterDefinition, binding: ValueParameterBinding, request: EffectRenderRequest): unknown {
	const evaluator = new ParameterBindingEvaluator(request.expressionEngine ?? null);
	const scope = request.parameterScope ?? {
		time: request.time * 1000, endTime: (request.endTime ?? Infinity) * 1000,
		variables: { TIME: request.time }, automationGraphs: [],
	};
	return mapParameterTree<ValueParameterBinding>(definition, binding, [], (leaf, source) => {
		const value = evaluator.evaluate(source, scope, leaf.defaultValue.value, leaf);
		if (leaf.dataType.kind === 'audioSource') return value == null ? null : request.resolveAudioSource?.(value, request.time) ?? null;
		return resolveLeaf(leaf, value);
	});
}

/** 呼び出し元がすでに評価した配列・構造体には、保存用Bindingや配列要素IDは含まれない。 */
export function normalizeEffectParameter(definition: ParameterDefinition, value: unknown): unknown {
	if (isParameterType(definition, 'array')) {
		if (!Array.isArray(value)) throw new Error(`Expected array for ${definition.ui.label}`);
		const element = getArrayElementDefinition(definition);
		return value.map(item => normalizeEffectParameter(element, item));
	}
	if (isParameterType(definition, 'struct')) {
		if (value == null || typeof value !== 'object') throw new Error(`Expected struct for ${definition.ui.label}`);
		return Object.fromEntries(Object.entries(getStructFieldDefinitions(definition)).map(([id, field]) =>
			[id, normalizeEffectParameter(field, (value as Record<string, unknown>)[id])]));
	}
	return resolveLeaf(definition, value);
}
