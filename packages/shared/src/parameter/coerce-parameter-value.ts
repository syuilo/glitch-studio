import type { ParameterDefinition } from './parameter-definition.ts';

/** 評価済みの値を受け取り側の型に合わせる。保存値や参照元のenum/stringは変更しない。 */
export function coerceParameterValue(definition: Pick<ParameterDefinition, 'dataType' | 'ui'>, value: unknown): unknown {
	if (definition.dataType.kind !== 'scalar' || typeof value !== 'string') return value;
	// parseFloatでは「1foo」まで受理してしまうため、文字列全体をNumberで変換する。
	// 空白だけの入力を0にしたり、NaN/Infinityを描画や音声処理へ渡したりせず、設定ミスとして報告する。
	const number = Number(value);
	if (value.trim() === '' || !Number.isFinite(number)) {
		throw new Error(`Invalid numeric string ${JSON.stringify(value)} for parameter ${JSON.stringify(definition.ui.label)}. Expected a finite number.`);
	}
	return number;
}
