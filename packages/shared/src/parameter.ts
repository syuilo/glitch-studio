 
/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType } from './data-type.ts';
import type { FitMode, WrapMode } from './types.ts';

type ParameterDefinitionBase<T extends DataType> = {
	dataType: T;
	defaultValue: { inputSource: 'literal'; value: any };
};

export type ParameterDefinition_Scalar = ParameterDefinitionBase<'scalar'> & {
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: number };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['scalar'] };
};
export type ParameterDefinition_Boolean = ParameterDefinitionBase<'bool'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: boolean };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['bool'] };
};
export type ParameterDefinition_Color = ParameterDefinitionBase<'color'> & {
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: [number, number, number, number] };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['color'] };
};
export type ParameterDefinition_Vector = ParameterDefinitionBase<'vector'> & {
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: [number, number] };
	// logarithmicの範囲・stepの扱いはrangeと同じ。各軸の実際の値を保存する。
	ui: { label: string; control: DataTypeUiControlDefinitionMap['vector'] };
};
export type ParameterDefinition_BlendMode = ParameterDefinitionBase<'blendMode'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: string }; // TODO
	ui: { label: string; control: DataTypeUiControlDefinitionMap['blendMode'] };
};
export type ParameterDefinition_FitMode = ParameterDefinitionBase<'fitMode'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: FitMode };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['fitMode'] };
};
export type ParameterDefinition_WrapMode = ParameterDefinitionBase<'wrapMode'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: WrapMode };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['wrapMode'] };
};
export type ParameterDefinition_Enum<Options extends readonly string[] = any> = ParameterDefinitionBase<'enum'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: Options[number] };
	ui: { label: string; labels: Record<Options[number], string>; control: DataTypeUiControlDefinitionMap['enum'] };
};
export type ParameterDefinition_AssetReference = ParameterDefinitionBase<'assetReference'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['assetReference'] };
};
export type ParameterDefinition_PlayerReference = ParameterDefinitionBase<'playerReference'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['playerReference'] };
};
export type ParameterDefinition_VideoAssetReference = ParameterDefinitionBase<'videoAssetReference'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['videoAssetReference'] };
};
export type ParameterDefinition_Struct<Fields extends Record<string, DataType> = any> = ParameterDefinitionBase<'struct'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: Record<string, any> }; // TODO
	ui: { label: string; labels: Record<keyof Fields, string>; control: DataTypeUiControlDefinitionMap['struct'] };
};
export type ParameterDefinition_Array = ParameterDefinitionBase<'array'> & {
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: any[] }; // TODO
	ui: { label: string; control: DataTypeUiControlDefinitionMap['array'] };
};

// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type ParameterDefinition_Any = ParameterDefinitionBase<'any'> & {
	canNode: true;
	// 4成分は色ではなくデータとして扱う。nullは未接続と同じゼロ値を表す。
	defaultValue: { inputSource: 'literal'; value: [number, number, number, number] | null };
	ui: { label: string; control: DataTypeUiControlDefinitionMap['any'] };
};

export type ParameterDefinition =
	| ParameterDefinition_Scalar | ParameterDefinition_Boolean | ParameterDefinition_Color | ParameterDefinition_Vector
	| ParameterDefinition_BlendMode | ParameterDefinition_FitMode | ParameterDefinition_WrapMode | ParameterDefinition_Enum
	| ParameterDefinition_AssetReference | ParameterDefinition_VideoAssetReference | ParameterDefinition_PlayerReference | ParameterDefinition_Struct | ParameterDefinition_Array | ParameterDefinition_Any;
