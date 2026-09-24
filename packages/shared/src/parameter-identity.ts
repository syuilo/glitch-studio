declare const parameterIdentity: unique symbol;

export type ParameterId = string & { readonly [parameterIdentity]: 'id' };
export type ParameterName = string & { readonly [parameterIdentity]: 'name' };

// 生成・入力・式との境界でのみ使う。既に分類済みのID/名前を相互変換させない。
// 実在性やスコープ内での可用性を保証する型ではなく、保存形式は通常の文字列のまま。
type UnbrandedString = string & { readonly [parameterIdentity]?: never };
export function parameterId(value: UnbrandedString): ParameterId {
	return value as unknown as ParameterId;
}
export function parameterName(value: UnbrandedString): ParameterName {
	return value as unknown as ParameterName;
}
