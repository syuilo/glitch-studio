import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import { deepEqual } from '@gs/shared/utility/deep-equal.ts';
import type { ParameterDefinition, ParameterChangeKind } from '@gs/shared/parameter/parameter-definition.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { EditableParameterBinding } from '../types/parameter-edit.ts';

/**
 * Bindingを丸ごと設定するAPIでも、配線や入力方式の変更を単なる値編集として通知しない。
 * レンダラーはこの区別で解像度・資源・履歴の再作成を判断するため、UIイベントではなく
 * 検証済みの変更前後から判定する。リセットの意図だけは専用Commandが明示する。
 */
export function getParameterBindingChangeKind(definition: ParameterDefinition, before: EditableParameterBinding, after: EditableParameterBinding): ParameterChangeKind {
	if (before.inputSource !== after.inputSource) return 'inputSource';
	if (before.inputSource === 'literal' && after.inputSource === 'literal') {
		if (definition.dataType.kind === 'array') {
			const previousElements = before.value as ParameterArrayElement<EditableParameterBinding>[];
			const nextElements = after.value as ParameterArrayElement<EditableParameterBinding>[];
			if (previousElements.length !== nextElements.length || previousElements.some((element, index) => element.id !== nextElements[index].id)) return 'arrayElements';
			const elementDefinition = getArrayElementDefinition(definition);
			return combineChangeKinds(nextElements.map((element, index) => getParameterBindingChangeKind(elementDefinition, previousElements[index].binding, element.binding)));
		}
		if (definition.dataType.kind === 'struct') {
			const previousFields = before.value as Record<string, EditableParameterBinding>;
			const nextFields = after.value as Record<string, EditableParameterBinding>;
			return combineChangeKinds(Object.entries(getStructFieldDefinitions(definition)).map(([key, field]) => getParameterBindingChangeKind(field, previousFields[key], nextFields[key])));
		}
	}
	switch (after.inputSource) {
		case 'node':
		case 'customNodeGraphEffectPublicParameterReference':
		case 'customNodeGraphEffectCustomParameterValueReference':
		case 'timelineLayerPublicParameterReference':
		case 'anotherLayerOutput':
		case 'lowerLayerOutput':
		case 'anotherLayerAudio':
		case 'lowerLayerAudio':
			return deepEqual(withoutExpressionModifier(before), withoutExpressionModifier(after)) ? 'value' : 'connection';
		default: return 'value';
	}
}

function withoutExpressionModifier(binding: EditableParameterBinding) {
	const source = { ...binding };
	if ('expressionModifier' in source) delete source.expressionModifier;
	return source;
}

function combineChangeKinds(kinds: readonly ParameterChangeKind[]): ParameterChangeKind {
	if (kinds.includes('arrayElements')) return 'arrayElements';
	if (kinds.includes('inputSource')) return 'inputSource';
	if (kinds.includes('connection')) return 'connection';
	return 'value';
}
