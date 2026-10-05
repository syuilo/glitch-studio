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
	| { kind: 'fontAssetReference' }
	| { kind: 'playerReference' }
	| { kind: 'audioSource' }
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
