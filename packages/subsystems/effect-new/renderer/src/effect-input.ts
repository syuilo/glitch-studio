import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement, ParameterBindingBase } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectEnvironment, EffectFrame, EffectParameterInput } from './effect-instance.ts';

export const DEFAULT_EFFECT_INPUT_SAMPLING = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } as const;

/** 型とBindingのツリーを初期化時に一度だけ対応付ける。配列の長さと各要素の種類も固定される。 */
export function createEffectInputTree<Binding extends ParameterBindingBase>(definition: ParameterDefinition, binding: Binding,
	compileLeaf: (definition: ParameterDefinition, binding: Binding) => EffectParameterInput): EffectParameterInput {
	if (definition.dataType.kind === 'array') {
		const element = getArrayElementDefinition(definition);
		const { value } = binding as Binding & { value: ParameterArrayElement<Binding>[] };
		return { kind: 'array', elements: value.map(item => createEffectInputTree(element, item.binding, compileLeaf)) };
	}
	if (definition.dataType.kind === 'struct') {
		const { value } = binding as Binding & { value: Record<string, Binding> };
		const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, field]) =>
			[key, createEffectInputTree(field, value[key], compileLeaf)]);
		return { kind: 'struct', fields: Object.fromEntries(fields) };
	}
	return compileLeaf(definition, binding);
}

export function createLiteralEffectInput(definition: ParameterDefinition, value: unknown): EffectParameterInput {
	if (definition.canNode !== true) return { kind: 'value', read: () => value };
	const uniform = constantShaderInput(definition.dataType.kind, value);
	return { kind: 'uniform', sampling: DEFAULT_EFFECT_INPUT_SAMPLING, read: () => uniform };
}

export function createEvaluatedEffectInput(definition: ParameterDefinition, read: (frame: EffectFrame) => unknown): EffectParameterInput {
	if (definition.canNode !== true) return { kind: 'value', read };
	return { kind: 'uniform', sampling: DEFAULT_EFFECT_INPUT_SAMPLING, read: frame => constantShaderInput(definition.dataType.kind, read(frame)) };
}

export function frameParameterScope(frame: EffectFrame, automationGraphs: ParameterEvaluationScope['automationGraphs']): ParameterEvaluationScope {
	return {
		time: frame.time * 1000, endTime: frame.endTime * 1000, automationGraphs,
		variables: { TIME: frame.time, TIME_MS: frame.time * 1000, END_TIME: frame.endTime, END_TIME_MS: frame.endTime * 1000,
			PROGRESS: frame.progress ?? (frame.endTime > 0 ? frame.time / frame.endTime : 0), IS_EXPORT: frame.isExport },
	};
}

/** 同じ解像度で生成した配置の静的な式変数を共有し、時刻と入力だけを評価時に更新する。 */
export function createValueBindingReader(def: ParameterDefinition, binding: ValueParameterBinding, evaluator: ParameterBindingEvaluator,
	getScope: (frame: EffectFrame) => ParameterEvaluationScope, placementVariables: ParameterEvaluationScope['variables'] | null) {
	if (binding.inputSource === 'literal' && binding.expressionModifier?.enabled !== true) return () => binding.value;
	return (frame: EffectFrame) => {
		const base = getScope(frame);
		const scope = placementVariables == null ? base : { ...base, variables: { ...base.variables, ...placementVariables,
			POINTER_POSITION: [frame.pointerPosition?.x ?? -99999, frame.pointerPosition?.y ?? -99999] } };
		return coerceParameterValue(def, validateEnumParameterValue(def, evaluator.evaluate(binding, scope, def.defaultValue.value, def)));
	};
}

export function createLiteralBindingInput(def: ParameterDefinition, value: unknown, resolveAudioSource: EffectEnvironment['resolveAudioSource']) {
	if (def.dataType.kind === 'audioSource') {
		return { kind: 'value', read: (frame: EffectFrame) => resolveAudioSource?.(value, frame) ?? null } as const;
	}
	return createLiteralEffectInput(def, coerceParameterValue(def, validateEnumParameterValue(def, value)));
}
