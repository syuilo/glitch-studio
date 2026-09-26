/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/naming-convention */

// アプリケーション共通のデータ型。UIの編集方法やGPU上の保存形式とは独立している。
export type DataType =
	| { kind: 'scalar' }
	| { kind: 'bool' }
	| { kind: 'string' }
	| { kind: 'color' }
	| { kind: 'vector' }
	| { kind: 'blendMode' }
	| { kind: 'fitMode' }
	| { kind: 'wrapMode' }
	| { kind: 'enum'; options: readonly string[] }
	| { kind: 'assetReference' }
	| { kind: 'videoAssetReference' }
	| { kind: 'playerReference' }
	| { kind: 'struct'; fields: Record<string, DataType> }
	| { kind: 'array'; elementType: DataType }
	| { kind: 'any' };

export type LeafDataType = Exclude<DataType, { kind: 'struct' | 'array' }>;

// 現在のレンダラーがノード間のテクスチャとして直接受け渡せる部分集合。
// 参照IDやコンテナは含めない。anyは接続するテクスチャのデータ型を限定しない指定。
export type TextureDataType = Extract<DataType, { kind: 'scalar' | 'color' | 'vector' | 'any' }>;

export function isTextureDataType(dataType: DataType): dataType is TextureDataType {
	return dataType.kind === 'scalar' || dataType.kind === 'color' || dataType.kind === 'vector' || dataType.kind === 'any';
}

// UIの範囲・刻みは入力操作用であり、式やノードから取得した値を制限しない。
type DataTypeUiControlDefinition_Scalar =
	// あくまで操作に便利な範囲であり、設定値が必ずこの範囲内に収まることは要求しない。
	| { controlType: 'number'; min?: number; max?: number; step?: number }
	// logarithmicは0 < min < maxで使用する。UI座標だけを対数変換し、値側のstepは適用しない。
	| { controlType: 'range'; min: number; max: number; step?: number; logarithmic?: boolean }
	// -1〜+1を-180〜+180度として表示する。保存値の規約はコントロールによらない。
	| { controlType: 'angle'; step?: number }
	| { controlType: 'seed' };

// 末端のコントロールは、自身の表示ラベルやパラメータのBindingを知らない。
export type DataTypeUiControlDefinitionMap = {
	scalar: DataTypeUiControlDefinition_Scalar;
	bool: {};
	string: {};
	color: {};
	// logarithmicの範囲・stepの扱いはrangeと同じ。各軸の実際の値を保存する。
	vector: { controlType: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number; logarithmic?: boolean };
	blendMode: {};
	fitMode: {};
	wrapMode: {};
	enum: { labels: Record<string, string> };
	assetReference: {};
	videoAssetReference: {};
	playerReference: {};
	any: {};
};

// コンテナの展開とフィールドラベルの表示は上位コンポーネントが担当する。
// 末端の値編集にはDataTypeUiDefinition<LeafDataType>を渡すため、コンテナの情報は不要。
// enumのlabelsは選択肢の表示名であり、コントロール自身のラベルではない。
export type DataTypeUiDefinition<T extends DataType = DataType> =
	T extends { kind: 'array'; elementType: infer E extends DataType }
		? { element: DataTypeUiDefinition<E> }
		: T extends { kind: 'struct'; fields: infer F extends Record<string, DataType> }
			? { fields: { [K in keyof F]: { label: string; control: DataTypeUiDefinition<F[K]> } } }
			: T extends { kind: 'enum'; options: readonly string[] }
				? { labels: Record<T['options'][number], string> }
				: T extends { kind: keyof DataTypeUiControlDefinitionMap }
					? DataTypeUiControlDefinitionMap[T['kind']]
					: never;

// オブジェクトの参照同一性ではなく値の型を比較する。フィールド・選択肢の並び順は型に影響しない。
export function areDataTypesEqual(a: DataType, b: DataType): boolean {
	if (a.kind !== b.kind) return false;
	if (a.kind === 'array' && b.kind === 'array') return areDataTypesEqual(a.elementType, b.elementType);
	if (a.kind === 'struct' && b.kind === 'struct') {
		return Object.keys(a.fields).length === Object.keys(b.fields).length
			&& Object.entries(a.fields).every(([key, type]) => Object.hasOwn(b.fields, key) && areDataTypesEqual(type, b.fields[key]));
	}
	if (a.kind === 'enum' && b.kind === 'enum') {
		const options = new Set(a.options);
		return options.size === new Set(b.options).size && b.options.every(option => options.has(option));
	}
	return true;
}
