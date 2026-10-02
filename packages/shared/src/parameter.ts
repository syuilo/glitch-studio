/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType, DataTypeUiDefinition, TextureDataType } from './data-type.ts';
import type { BlendMode } from './color-blend.ts';
import type { FitMode, ParameterBinding, WrapMode } from './types.ts';

// 値には式・キー・automationの内容を含む。入力方式の切替、接続先の変更、
// 配列要素の追加削除、既定値へのリセットとは分けて、行った編集を表す。
export type ParameterChangeKind = 'value' | 'inputSource' | 'connection' | 'arrayElements' | 'reset';

// IDは同じ配列内で一意。値やBindingの種類が変わっても編集対象を追跡できるよう、
// Bindingの外側に保持する。評価後の配列やDataType自体にはこのIDを含めない。
export type ParameterArrayElement<Binding extends ParameterBinding = ParameterBinding> = {
	id: string;
	binding: Binding;
};

// 初期値として保存する値。アセットはIDまたは未選択、プレイヤーの初期参照は未選択とする。
// anyの4成分は色ではなくデータであり、nullは未接続と同じゼロ値を表す。
type ParameterDefaultValueMap = {
	scalar: number;
	bool: boolean;
	string: string;
	color: [number, number, number, number];
	vector: [number, number];
	blendMode: BlendMode;
	fitMode: FitMode;
	wrapMode: WrapMode;
	assetReference: string | null;
	videoAssetReference: string | null;
	fontAssetReference: string | null;
	playerReference: null;
	any: [number, number, number, number] | null;
};

// コンテナ内部は素の値ではなく子ごとのBindingを保持する。
// キーフレームのリテラル値や、レンダラーが評価済みの値とは別の構造。
export type ParameterDefaultValue<T extends DataType> = {
	inputSource: 'literal';
	value: T extends { kind: 'array'; elementType: infer E extends DataType }
		? ParameterArrayElement<ParameterDefaultBinding<E>>[]
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
export type ParameterDefinition_String = ParameterDefinition<{ kind: 'string' }>;
export type ParameterDefinition_Color = ParameterDefinition<{ kind: 'color' }>;
export type ParameterDefinition_Vector = ParameterDefinition<{ kind: 'vector' }>;
export type ParameterDefinition_BlendMode = ParameterDefinition<{ kind: 'blendMode' }>;
export type ParameterDefinition_FitMode = ParameterDefinition<{ kind: 'fitMode' }>;
export type ParameterDefinition_WrapMode = ParameterDefinition<{ kind: 'wrapMode' }>;
export type ParameterDefinition_Enum<Options extends readonly string[] = readonly string[]> = ParameterDefinition<{ kind: 'enum'; options: Options }>;
export type ParameterDefinition_AssetReference = ParameterDefinition<{ kind: 'assetReference' }>;
export type ParameterDefinition_VideoAssetReference = ParameterDefinition<{ kind: 'videoAssetReference' }>;
export type ParameterDefinition_FontAssetReference = ParameterDefinition<{ kind: 'fontAssetReference' }>;
export type ParameterDefinition_PlayerReference = ParameterDefinition<{ kind: 'playerReference' }>;
export type ParameterDefinition_Struct<Fields extends Record<string, DataType> = Record<string, DataType>> = ParameterDefinition<{ kind: 'struct'; fields: Fields }>;
export type ParameterDefinition_Array<Element extends DataType = DataType> = ParameterDefinition<{ kind: 'array'; elementType: Element }>;
// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type ParameterDefinition_Any = ParameterDefinition<{ kind: 'any' }>;

// ネストした識別子の判定だけではTypeScriptが親のunionを絞り込めないため、
// 設定やUIも含む定義全体を対応する種類に絞り込む。
export function isParameterType<P extends ParameterDefinition, K extends DataType['kind']>(definition: P, kind: K): definition is P & ParameterDefinition<Extract<DataType, { kind: K }>> {
	return definition.dataType.kind === kind;
}

// 選択肢の削除・改名後も保存済みのBindingや式は残す。
// 実際に使う境界で検証し、古い値や式が返した範囲外の値を描画エラーとして報告する。
export function validateEnumParameterValue<T>(definition: ParameterDefinition, value: T): T {
	if (isParameterType(definition, 'enum') && (typeof value !== 'string' || !definition.dataType.options.includes(value))) {
		throw new Error(`Invalid enum value ${JSON.stringify(value)} for parameter ${JSON.stringify(definition.ui.label)}. Expected one of: ${JSON.stringify(definition.dataType.options)}`);
	}
	return value;
}

// 保存形式は型・UI・設定を分離し、子を処理する場面でのみ定義として組み合わせる。
// 配列要素の行ラベル（インデックス等）は呼び出し側が付ける。
export function getArrayElementDefinition(definition: ParameterDefinition): ParameterDefinition {
	if (!isParameterType(definition, 'array')) throw new Error('Expected array parameter definition');
	return {
		...definition.element,
		dataType: definition.dataType.elementType,
		ui: { label: definition.ui.label, control: definition.ui.control.element },
	} as ParameterDefinition;
}

export function getStructFieldDefinitions(definition: ParameterDefinition): Record<string, ParameterDefinition> {
	if (!isParameterType(definition, 'struct')) throw new Error('Expected struct parameter definition');
	return Object.fromEntries(Object.entries(definition.dataType.fields).map(([key, dataType]) => [key, {
		...definition.fields[key],
		dataType,
		ui: definition.ui.control.fields[key],
	} as ParameterDefinition]));
}
