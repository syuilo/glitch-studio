/* eslint-disable @typescript-eslint/no-empty-object-type */
/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType } from './data-type.ts';

// 表示範囲の編集方法を示す固定構造。値の型は通常のstructのままとし、
// 各フィールドの式・キーフレーム・参照は既存のパラメータツリーで扱う。
export type Viewport2DFields = {
	center: { kind: 'vector' };
	zoom: { kind: 'scalar' };
	// 回転を持たない表示範囲では省略し、編集時には回転0として扱う。
	rotation?: { kind: 'scalar' };
};

export type Viewport2DControl = {
	controlType: 'viewport2d';
	// Zoom=1で参照する平面の長辺の長さ。centerと同じ単位を使い、
	// 画面の長辺全体=1の共通座標からの換算を描画側と一致させる。
	spanAtZoomOne: number;
	// 描画側が倍率に下限を適用する場合は同じ値を指定する。
	minimumZoom?: number;
};

// 広いParameterDefinitionでは両方のUIを受け取り、具体的なフィールドが
// 確定した定義では必須フィールドとその型を検査する。
type StructControl<F extends Record<string, DataType>> =
	| { controlType?: 'struct' }
	| (string extends keyof F ? Viewport2DControl : F extends Viewport2DFields ? Viewport2DControl : never);

// UIの範囲・刻みは入力操作用であり、式やノードから取得した値を制限しない。
type DataTypeUiControlDefinition_Scalar =
	// あくまで操作に便利な範囲であり、設定値が必ずこの範囲内に収まることは要求しない。
	| { controlType: 'number'; min?: number; max?: number; step?: number }
	// logarithmicは0 < min < maxで使用する。UI座標だけを対数変換し、値側のstepは適用しない。
	| { controlType: 'range'; min: number; max: number; step?: number; logarithmic?: boolean }
	// 1を1周とするturn単位。式・ノード入力・保存値もturnで扱い、UIでは度を併記する。
	// 複数周の情報を失わないよう、コントロールや共通の値評価では折り返さない。
	| { controlType: 'angle'; step?: number }
	| { controlType: 'seed' };

// 末端のコントロールは、自身の表示ラベルやパラメータのBindingを知らない。
export type DataTypeUiControlDefinitionMap = {
	scalar: DataTypeUiControlDefinition_Scalar;
	bool: {};
	string: {};
	color: { controlType?: 'color' | 'signal'; };
	colorRamp: {};
	// logarithmicの範囲・stepの扱いはrangeと同じ。各軸の実際の値を保存する。
	vector: { controlType: 'vector' | 'xy' | 'dimension'; min?: number; max?: number; step?: number; logarithmic?: boolean };
	blendMode: {};
	fitMode: {};
	sizeReference: {};
	wrapMode: {};
	enum: { labels: Record<string, string> };
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
			? { fields: { [K in keyof F]: { label: string; isAdvanced?: boolean; control: DataTypeUiDefinition<F[K]> } } } & StructControl<F>
			: T extends { kind: 'enum'; options: readonly string[] }
				? { labels: Record<T['options'][number], string> }
				: T extends { kind: keyof DataTypeUiControlDefinitionMap }
					? DataTypeUiControlDefinitionMap[T['kind']]
					: never;
