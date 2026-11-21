import type { DataType } from '../data-type/data-type.ts';
import type { ParameterDefinition } from './parameter-definition.ts';

/** 文字列から数値への変換可否はデータ型の組で決め、値の妥当性は検査しない。 */
export function canCoerceParameterDataType(source: DataType, destination: DataType): boolean {
	return destination.kind === 'scalar' && (source.kind === 'string' || source.kind === 'enum');
}

/** 評価済みの値を受け取り側の型に合わせる。保存値や参照元のenum/stringは変更しない。 */
export function coerceParameterValue(definition: Pick<ParameterDefinition, 'dataType'>, value: unknown): unknown {
	if (definition.dataType.kind !== 'scalar' || typeof value !== 'string') return value;
	// parseFloatでは「1foo」まで受理してしまうため、文字列全体をNumberで変換する。
	// 不正な値の動作は保証しないため、変換後のNaNやInfinityもそのまま渡す。
	return Number(value);
}
