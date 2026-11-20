import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EditableParameterBinding } from '@/types/parameter-edit.ts';

type NamedParameterDataType = Extract<DataType, { kind: 'scalar' | 'bool' | 'string' | 'color' | 'vector' | 'enum' | 'colorRamp' | 'sizeReference' }>;

export function canCreateNamedParameterFromBinding(definition: ParameterDefinition, binding: EditableParameterBinding): boolean {
	// 加工式は無効でも本文を保持しているため対象外にする。別スコープへの移動で
	// 参照関数・環境変数の意味を変えたり、現在は無効な設定を黙って捨てたりしないため。
	return ['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference'].includes(definition.dataType.kind)
		&& binding.inputSource === 'literal' && binding.expressionModifier == null;
}

export function createNamedParameterFromLiteral(
	definition: ParameterDefinition,
	binding: EditableParameterBinding,
	existingDefinitions: readonly { nameForReference: string }[],
): ParameterDefinition<NamedParameterDataType> & { canNode: false; nameForReference: string } {
	if (!canCreateNamedParameterFromBinding(definition, binding) || binding.inputSource !== 'literal') throw new Error('Only literal value parameters without expression modifiers can become named parameters');
	let baseName = definition.ui.label.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
	if (baseName.length === 0) baseName = 'my_param';
	if (/^[0-9]/.test(baseName)) baseName = `param_${baseName}`;
	let nameForReference = baseName;
	for (let suffix = 2; existingDefinitions.some(existing => existing.nameForReference === nameForReference); suffix++) nameForReference = `${baseName}_${suffix}`;

	// 元の「詳細設定」扱いは作成先へ持ち込まない。共通化した操作項目が
	// 初期状態で隠れないよう、値の型・編集UI・現在値だけを引き継ぐ。
	return deepClone({
		dataType: definition.dataType,
		ui: { label: definition.ui.label, control: definition.ui.control },
		defaultValue: { inputSource: 'literal', value: binding.value },
		canNode: false,
		nameForReference,
	}) as ParameterDefinition<NamedParameterDataType> & { canNode: false; nameForReference: string };
}
