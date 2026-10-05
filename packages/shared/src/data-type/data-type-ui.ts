/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType } from './data-type.ts';

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
	color: { controlType?: 'color' | 'signal'; };
	// logarithmicの範囲・stepの扱いはrangeと同じ。各軸の実際の値を保存する。
	vector: { controlType: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number; logarithmic?: boolean };
	blendMode: {};
	fitMode: {};
	wrapMode: {};
	enum: { labels: Record<string, string> };
	assetReference: {};
	videoAssetReference: {};
	fontAssetReference: {};
	playerReference: {};
	audioSource: {};
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
