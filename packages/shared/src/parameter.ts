/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType, DataTypeUiDefinition, TextureDataType } from './data-type.ts';
import type { FitMode, ParameterBinding, WrapMode } from './types.ts';

// 初期値として保存する値。アセット・プレイヤーの初期参照は未選択とする。
// anyの4成分は色ではなくデータであり、nullは未接続と同じゼロ値を表す。
type ParameterDefaultValueMap = {
	scalar: number;
	bool: boolean;
	color: [number, number, number, number];
	vector: [number, number];
	blendMode: string; // TODO: 合成方法の型に置き換える。
	fitMode: FitMode;
	wrapMode: WrapMode;
	assetReference: null;
	videoAssetReference: null;
	playerReference: null;
	any: [number, number, number, number] | null;
};

// コンテナ内部は素の値ではなく子ごとのBindingを保持する。
// キーフレームのリテラル値や、レンダラーが評価済みの値とは別の構造。
export type ParameterDefaultValue<T extends DataType> = {
	inputSource: 'literal';
	value: T extends { kind: 'array'; elementType: infer E extends DataType }
		? ParameterDefaultBinding<E>[]
		: T extends { kind: 'struct'; fields: infer F extends Record<string, DataType> }
			? { [K in keyof F]: ParameterDefaultBinding<F[K]> }
			: T extends { kind: 'enum'; options: readonly string[] }
				? T['options'][number]
				: T extends { kind: keyof ParameterDefaultValueMap }
					? ParameterDefaultValueMap[T['kind']]
					: never;
};

// コンテナ自体の式・接続は扱わず、末端でのみ非literalのBindingを許可する。
type ParameterDefaultBinding<T extends DataType> = T extends { kind: 'array' | 'struct' }
	? ParameterDefaultValue<T>
	: ParameterDefaultValue<T> | Exclude<ParameterBinding, { inputSource: 'literal' }>;

// 型とUIは別のツリーにあるため、ここでは子の接続可否・初期値だけを定義する。
// element.defaultValueは要素追加時の初期値、外側のdefaultValueは配列全体の初期値。
export type ParameterSettings<T extends DataType> = T extends DataType
	? { defaultValue: ParameterDefaultValue<T> } & (
		T extends { kind: 'array'; elementType: infer E extends DataType }
			? { canNode?: false; element: ParameterSettings<E> }
			: T extends { kind: 'struct'; fields: infer F extends Record<string, DataType> }
				? { canNode?: false; fields: { [K in keyof F]: ParameterSettings<F[K]> } }
				: T extends { kind: 'any' }
					? { canNode: true }
					: T extends TextureDataType
						? { canNode?: boolean }
						: { canNode?: false }
	)
	: never;

// Tを分配して、dataType・UI・設定の対応を各種類ごとに保つ。
// フィールド名やenumの選択肢まで検証する場合は具体的なTを指定する。
export type ParameterDefinition<T extends DataType = DataType> = T extends DataType
	? {
		dataType: T;
		ui: { label: string; control: DataTypeUiDefinition<T> };
	} & ParameterSettings<T>
	: never;

// ジェネリックな定義関数では余剰プロパティ検査が働かないため、
// 実際に推論したキーを具体的なスキーマと照合する。配列・unionも再帰的に扱う。
// Expected側を分配し、Bindingの各inputSourceやscalarの各controlTypeを混ぜない。
type ExactParameterShape<Actual, Expected> = Expected extends unknown
	? Actual extends Expected
		? Actual extends readonly unknown[]
			? Expected extends readonly (infer E)[]
				? { [K in keyof Actual]: ExactParameterShape<Actual[K], E> }
				: never
			: Actual extends object
				? { [K in keyof Actual]: K extends keyof Expected ? ExactParameterShape<Actual[K], Expected[K]> : never }
				: Actual
		: never
	: never;

// dataTypeからフィールド名を確定し、UIや初期値から型が広がるのを防ぐ。
export type CheckedParameterDefinition<P extends ParameterDefinition> =
	ExactParameterShape<P, ParameterDefinition<P['dataType']>>;

export type ParameterDefinition_Scalar = ParameterDefinition<{ kind: 'scalar' }>;
export type ParameterDefinition_Boolean = ParameterDefinition<{ kind: 'bool' }>;
export type ParameterDefinition_Color = ParameterDefinition<{ kind: 'color' }>;
export type ParameterDefinition_Vector = ParameterDefinition<{ kind: 'vector' }>;
export type ParameterDefinition_BlendMode = ParameterDefinition<{ kind: 'blendMode' }>;
export type ParameterDefinition_FitMode = ParameterDefinition<{ kind: 'fitMode' }>;
export type ParameterDefinition_WrapMode = ParameterDefinition<{ kind: 'wrapMode' }>;
export type ParameterDefinition_Enum<Options extends readonly string[] = readonly string[]> = ParameterDefinition<{ kind: 'enum'; options: Options }>;
export type ParameterDefinition_AssetReference = ParameterDefinition<{ kind: 'assetReference' }>;
export type ParameterDefinition_VideoAssetReference = ParameterDefinition<{ kind: 'videoAssetReference' }>;
export type ParameterDefinition_PlayerReference = ParameterDefinition<{ kind: 'playerReference' }>;
export type ParameterDefinition_Struct<Fields extends Record<string, DataType> = Record<string, DataType>> = ParameterDefinition<{ kind: 'struct'; fields: Fields }>;
export type ParameterDefinition_Array<Element extends DataType = DataType> = ParameterDefinition<{ kind: 'array'; elementType: Element }>;
// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type ParameterDefinition_Any = ParameterDefinition<{ kind: 'any' }>;
