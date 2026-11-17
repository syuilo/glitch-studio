import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EditableParameterBinding } from '@/types/parameter-edit.ts';
import { isParameterBindingDefault } from '@gs/shared/parameter/parameter-default.ts';

// 行とセクションの表示判定を揃える。Timelineでは主入力の自動接続など、
// エフェクト定義とは異なる初期Bindingも渡されるため、同じ基準値で比較する。
export function isParameterVisible(definition: ParameterDefinition, binding: EditableParameterBinding, defaultBinding: EditableParameterBinding, showAdvancedParameters: boolean): boolean {
	return definition.ui.isAdvanced !== true || showAdvancedParameters || !isParameterBindingDefault(definition, binding, defaultBinding);
}
