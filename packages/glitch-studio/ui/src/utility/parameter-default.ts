import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { genId } from '@gs/shared/utility/id.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

// リセット対象自身のIDは親が所有する。ここでは対象の内側にある配列のIDを新しくする。
export function createResetParameterBinding(definition: ParameterDefinition) {
	return createDefaultParameterBinding(definition, genId);
}
