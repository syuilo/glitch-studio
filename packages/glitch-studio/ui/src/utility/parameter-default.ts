import { deepClone } from '@gs/shared/utility/deep-clone.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterArrayElement } from '@gs/shared/parameter/parameter-binding.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// リセットでは既定の要素を復活させず、新しい要素として作り直す。
// 対象要素自身のIDは親が持つため維持し、そのBinding内部にある配列のIDだけを再発行する。
// 新規ノードの生成は既定IDのdeepCloneでよく、Undo/Redoは保存した結果をそのまま復元する。
export function createResetParameterBinding(definition: ParameterDefinition): ParameterDefaultValue {
	const binding = deepClone(definition.defaultValue);

	function renewArrayElementIds(dataType: DataType, defaultBinding: ParameterDefaultValue): void {
		if (dataType.kind === 'array') {
			for (const element of defaultBinding.value as ParameterArrayElement<ParameterDefaultValue>[]) {
				element.id = genId();
				renewArrayElementIds(dataType.elementType, element.binding);
			}
		} else if (dataType.kind === 'struct') {
			const fields = defaultBinding.value as Record<string, ParameterDefaultValue>;
			for (const [key, fieldType] of Object.entries(dataType.fields)) {
				renewArrayElementIds(fieldType, fields[key]);
			}
		}
	}

	// color/vectorの数値配列を配列パラメータと混同しないよう、dataTypeに沿ってたどる。
	renewArrayElementIds(definition.dataType, binding);
	return binding;
}
