import { constantShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

/** 評価済みの通常パラメータを入力へ変換する。素材参照は静的設定で解決済み。 */
export function resolveEffectParameterValue(definition: Pick<ParameterDefinition, 'dataType' | 'canNode'>, value: any): any {
	return definition.canNode === true ? constantShaderInput(definition.dataType.kind, value) : value;
}
