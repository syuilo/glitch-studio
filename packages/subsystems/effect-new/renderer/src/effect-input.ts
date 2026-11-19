import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import { coerceParameterValue } from '@gs/shared/parameter/coerce-parameter-value.ts';
import { getArrayElementDefinition, getStructFieldDefinitions, validateEnumParameterValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { EffectEnvironment, EffectFrame, EffectParameterInput } from './effect-instance.ts';

export const DEFAULT_EFFECT_INPUT_SAMPLING = { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' } as const;

/** 既定値のツリーを初期化時に一度だけ展開し、末端の定数を各フレームで共有する。 */
export function createDefaultEffectInput(definition: ParameterDefinition, resolveAudioSource: EffectEnvironment['resolveAudioSource'],
	binding: ParameterDefaultValue = definition.defaultValue): EffectParameterInput {
	if (definition.dataType.kind === 'array') {
		const element = getArrayElementDefinition(definition);
		const elements = binding.value as ParameterArrayElement<ParameterDefaultValue>[];
		return { kind: 'array', elements: elements.map(item => createDefaultEffectInput(element, resolveAudioSource, item.binding)) };
	}
	if (definition.dataType.kind === 'struct') {
		const value = binding.value as Record<string, ParameterDefaultValue>;
		const fields = Object.entries(getStructFieldDefinitions(definition)).map(([key, field]) =>
			[key, createDefaultEffectInput(field, resolveAudioSource, value[key])]);
		return { kind: 'struct', fields: Object.fromEntries(fields) };
	}
	return createLiteralBindingInput(definition, binding.value, resolveAudioSource);
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

export function createLiteralBindingInput(def: ParameterDefinition, value: unknown, resolveAudioSource: EffectEnvironment['resolveAudioSource']) {
	if (def.dataType.kind === 'audioSource') {
		return { kind: 'value', read: (frame: EffectFrame) => resolveAudioSource?.(value, frame) ?? null } as const;
	}
	return createLiteralEffectInput(def, coerceParameterValue(def, validateEnumParameterValue(def, value)));
}
