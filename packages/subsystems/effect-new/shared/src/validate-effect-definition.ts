import { isTextureDataType } from '@gs/shared/data-type/data-type.ts';
import { isValueParameterBinding } from '@gs/shared/parameter/parameter-binding.ts';
import { validateLiteralAudioSourceBinding } from '@gs/shared/parameter/audio-source.ts';
import { prepareExpressionParameterValue } from '@gs/shared/parameter/expression-parameter-value.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { inspectStaticParameter, validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { EffectDefinition } from './effect-definition.ts';

export function validateEffectValueBinding(definition: ParameterDefinition, binding: ValueParameterBinding): void {
	inspectStaticParameter(definition, binding, (leaf, source) => {
		if (!isValueParameterBinding(source)) throw new Error('Unknown value input source');
		if (leaf.dataType.kind === 'audioSource') {
			validateLiteralAudioSourceBinding(source);
			return;
		}
		if (source.inputSource !== 'literal') return;
		// 保存する定数は宣言型に従う。式の評価結果で許される数値文字列や可変長anyへの換算を持ち込まない。
		if (leaf.dataType.kind === 'scalar' && typeof source.value !== 'number') throw new Error(`Invalid scalar literal for ${leaf.ui.label}`);
		if (leaf.dataType.kind === 'any' && source.value != null && (!Array.isArray(source.value) || source.value.length !== 4)) throw new Error(`Invalid any literal for ${leaf.ui.label}`);
		prepareExpressionParameterValue(leaf, source.value);
	});
}

function validateDefaultType(definition: ParameterDefinition): void {
	if (definition.defaultValue.inputSource !== 'literal') throw new Error('A parameter default must be a literal');
	if (definition.dataType.kind === 'audioSource' && definition.defaultValue.value != null) throw new Error('A default audio source must be disconnected');
	if (definition.canNode === true && !isTextureDataType(definition.dataType)) throw new Error('Only spatial parameters can accept a node');
	validateEffectValueBinding(definition, definition.defaultValue);
	// 空配列でも追加時に使われる要素定義の初期値を確かめる。
	if (definition.dataType.kind === 'array') validateDefaultType(getArrayElementDefinition(definition));
	if (definition.dataType.kind === 'struct') {
		for (const field of Object.values(getStructFieldDefinitions(definition))) validateDefaultType(field);
	}
}

export function validateEffectDefinition(definition: EffectDefinition): void {
	for (const [id, parameter] of Object.entries(definition.paramDefs)) {
		if (id.length === 0) throw new Error('Empty parameter ID');
		validateParameterDefaultValues(parameter);
		validateDefaultType(parameter);
	}
	for (const [id, output] of Object.entries(definition.outputDefs)) {
		if (id.length === 0 || !isTextureDataType(output.dataType)) throw new Error(`Invalid output: ${id}`);
	}
	const { primaryInputId, primaryAudioInputId, primaryOutputId } = definition;
	if (primaryInputId != null) {
		const parameter = Object.hasOwn(definition.paramDefs, primaryInputId) ? definition.paramDefs[primaryInputId] : null;
		if (parameter?.canNode !== true || parameter.dataType.kind !== 'color') throw new Error(`Invalid primary image input: ${primaryInputId}`);
	}
	if (primaryAudioInputId != null && (!Object.hasOwn(definition.paramDefs, primaryAudioInputId) || definition.paramDefs[primaryAudioInputId].dataType.kind !== 'audioSource')) {
		throw new Error(`Invalid primary audio input: ${primaryAudioInputId}`);
	}
	if (primaryOutputId != null && !Object.hasOwn(definition.outputDefs, primaryOutputId)) throw new Error(`Unknown primary output: ${primaryOutputId}`);
}
