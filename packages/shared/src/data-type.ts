//// アプリケーション共通のデータ型。UIの編集方法やGPU上の保存形式とは独立している。
//export type DataType =
//	| 'scalar'
//	| 'bool'
//	| 'color'
//	| 'vector'
//	| 'blendMode'
//	| 'fitMode'
//	| 'wrapMode'
//	| 'enum'
//	| 'assetReference'
//	| 'videoAssetReference'
//	| 'playerReference'
//	| 'struct'
//	| 'array'
//	| 'any';

export type DataType =
	{ kind: 'scalar' }
	| { kind: 'bool' }
	| { kind: 'color' }
	| { kind: 'vector' }
	| { kind: 'blendMode' }
	| { kind: 'fitMode' }
	| { kind: 'wrapMode' }
	| { kind: 'enum'; options: string[] }
	| { kind: 'assetReference' }
	| { kind: 'videoAssetReference' }
	| { kind: 'playerReference' }
	| { kind: 'struct'; fields: Record<string, DataType> }
	| { kind: 'array'; elementType: DataType }
	| { kind: 'any' };

export type LeafDataType = Exclude<
	DataType,
	{ kind: 'struct' | 'array' }
>;

// 現在のレンダラーがノード間のテクスチャとして直接受け渡せる部分集合。
// 参照IDやコンテナは含めない。anyは接続するテクスチャのデータ型を限定しない指定。
export type TextureDataType = Extract<DataType, 'scalar' | 'color' | 'vector' | 'any'>;

export function isTextureDataType(dataType: DataType): dataType is TextureDataType {
	return dataType === 'scalar' || dataType === 'color' || dataType === 'vector' || dataType === 'any';
}

// UIの範囲・刻みは入力操作用であり、式やノードから取得した値を制限しない。
type DataTypeUiControlDefinition_Scalar =
	// あくまで「UI上ではこれくらいの範囲でスライダーを操作できると便利」を示すもので、必ずこの範囲内に値が設定されることを要求するものではない
	| { controlType: 'number'; min?: number; max?: number; step?: number }
	// logarithmicは0 < min < maxで使用する。UI座標だけを対数変換し、値側のstepは適用しない。
	| { controlType: 'range'; min: number; max: number; step?: number; logarithmic?: boolean }
	// -1〜+1を-180〜+180度として表示する。保存値の規約はコントロールによらない。
	| { controlType: 'angle'; step?: number }
	| { controlType: 'seed' };

export type DataTypeUiControlDefinitionMap = {
	scalar: DataTypeUiControlDefinition_Scalar;
	bool: { };
	color: { };
	vector: { controlType: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number; logarithmic?: boolean };
	blendMode: { };
	fitMode: { };
	wrapMode: { };
	enum: { labels: Record<string, string> };
	assetReference: { };
	videoAssetReference: { };
	playerReference: { };
	struct: { labels: Record<string, string>; fields: Record<string, DataTypeUiControlDefinitionMap[string]> };
	array: { element: DataTypeUiControlDefinitionMap[string] };
	any: { };
};
