import { deepEqual } from '../utility/deep-equal.ts';
import { deepClone } from '../utility/deep-clone.ts';
import { createDefaultColorRamp } from '../color-ramp.ts';
import { isLiteralParameterBinding } from './parameter-binding.ts';
import type { DataType } from '../data-type/data-type.ts';
import type { ParameterArrayElement, ParameterBindingBase } from './parameter-binding.ts';
import type { ParameterDefaultValue, ParameterDefinition, ParameterSettings } from './parameter-definition.ts';
import type { ParameterExpressionModifier, ValueParameterBinding } from './value-parameter-binding.ts';

type LiteralBinding = Extract<ValueParameterBinding, { inputSource: 'literal' }>;

/**
 * 未設定の配列を表示したパスでそのまま初回編集できるよう、既定のIDは配列内の位置から作る。
 * リセットや要素追加で配列を作り直すときは、呼び出し側が新しいIDの発行方法を渡す。
 */
export function createDefaultParameterBinding(definition: Pick<ParameterDefinition, 'dataType' | 'defaultValue'>,
	createArrayElementId: (index: number) => string = index => `default-${index}`): LiteralBinding {
	function bind(dataType: DataType, value: ParameterDefaultValue): LiteralBinding {
		if (dataType.kind === 'array') {
			const elements = (value as ParameterDefaultValue[]).map((element, index) => ({ id: createArrayElementId(index), binding: bind(dataType.elementType, element) }));
			return { inputSource: 'literal', value: elements };
		}
		if (dataType.kind === 'struct') {
			const fields = value as Record<string, ParameterDefaultValue>;
			return { inputSource: 'literal', value: Object.fromEntries(Object.entries(dataType.fields).map(([key, fieldType]) => [key, bind(fieldType, fields[key])])) };
		}
		return { inputSource: 'literal', value: deepClone(value) };
	}

	return bind(definition.dataType, definition.defaultValue);
}

// 型変更時にも利用するため、完成済みのUIや最上位の初期値は要求しない。
// structの空値には各フィールドの初期値を使う。
type EmptyValueDefinition =
	| { dataType: Exclude<DataType, { kind: 'struct' }> }
	| { dataType: Extract<DataType, { kind: 'struct' }>; fields: Record<string, ParameterSettings<DataType>> };

export function genEmptyValue(paramDef: EmptyValueDefinition): any {
	switch (paramDef.dataType.kind) {
		case 'scalar': return 0;
		case 'enum': return paramDef.dataType.options[0] ?? '';
		case 'bool': return false;
		case 'string': return '';
		case 'blendMode': return 'normal';
		case 'fitMode': return 'stretch';
		case 'sizeReference': return 'longSide';
		case 'wrapMode': return 'repeatMirrored';
		case 'vector': return [0, 0];
		case 'color': return [0, 0, 0, 1];
		case 'colorRamp': return createDefaultColorRamp();
		case 'any': case 'audioSource': return null;
		case 'array': return [];
		case 'struct': {
			if (!('fields' in paramDef)) throw new Error('Struct parameter settings are required');
			return Object.fromEntries(Object.keys(paramDef.dataType.fields).map(key => [key, deepClone(paramDef.fields[key].defaultValue)]));
		}
	}
}

/**
 * 評価結果ではなく、保存した設定が既定状態かを判定する。
 * Timelineなどの利用場所による初期接続の上書きは、呼び出し側でdefaultBindingへ渡す。
 * UIの表示方針や、各ドメイン固有の入力方式の定義には依存しない。
 */
export function isParameterBindingDefault(
	definition: Pick<ParameterDefinition, 'dataType' | 'defaultValue'>,
	binding: ParameterBindingBase,
	defaultBinding: ParameterBindingBase = createDefaultParameterBinding(definition),
): boolean {
	return areBindingsEqual(definition.dataType, binding, defaultBinding);
}

function areBindingsEqual(dataType: DataType, binding: ParameterBindingBase, defaultBinding: ParameterBindingBase): boolean {
	if (binding.inputSource !== defaultBinding.inputSource) return false;
	// 未指定とnullはどちらも加工なし。無効化した加工式は本文を保持するため、
	// 加工なしとは区別し、既定値へ戻したものとして隠してしまわない。
	const current = { ...binding, expressionModifier: getExpressionModifier(binding) };
	const baseline = { ...defaultBinding, expressionModifier: getExpressionModifier(defaultBinding) };
	if (!isLiteralParameterBinding(binding) || !isLiteralParameterBinding(defaultBinding)) return deepEqual(current, baseline);

	if (dataType.kind === 'array') {
		const elements = binding.value as ParameterArrayElement<ParameterBindingBase>[];
		const defaultElements = defaultBinding.value as ParameterArrayElement<ParameterBindingBase>[];
		if (elements.length !== defaultElements.length) return false;
		// 要素IDは編集対象の追跡用で、リセットでも再発行される。
		// 見た目や設定内容の差ではないため、順序とBindingだけを比較する。
		if (!elements.every((element, index) => areBindingsEqual(dataType.elementType, element.binding, defaultElements[index].binding))) return false;
	} else if (dataType.kind === 'struct') {
		for (const [key, fieldType] of Object.entries(dataType.fields)) {
			if (!areBindingsEqual(fieldType, binding.value[key], defaultBinding.value[key])) return false;
		}
	} else {
		return deepEqual(current, baseline);
	}
	// 子の値は型に従って比較済み。コンテナの残りの設定も比較しておく。
	return deepEqual({ ...current, value: null }, { ...baseline, value: null });
}

function getExpressionModifier(binding: ParameterBindingBase): ParameterExpressionModifier | null {
	return 'expressionModifier' in binding ? (binding.expressionModifier as ParameterExpressionModifier | null | undefined) ?? null : null;
}
