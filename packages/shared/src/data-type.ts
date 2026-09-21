// アプリケーション共通のデータ型。UIの編集方法やGPU上の保存形式とは独立している。
export type DataType =
	| 'scalar'
	| 'bool'
	| 'color'
	| 'vector'
	| 'blendMode'
	| 'fitMode'
	| 'wrapMode'
	| 'enum'
	| 'assetReference'
	| 'videoAssetReference'
	| 'playerReference'
	| 'struct'
	| 'array'
	| 'any';

// 現在のレンダラーがノード間のテクスチャとして直接受け渡せる部分集合。
// 参照IDやコンテナは含めない。anyは接続するテクスチャのデータ型を限定しない指定。
export type TextureDataType = Extract<DataType, 'scalar' | 'color' | 'vector' | 'any'>;

export function isTextureDataType(dataType: DataType): dataType is TextureDataType {
	return dataType === 'scalar' || dataType === 'color' || dataType === 'vector' || dataType === 'any';
}
