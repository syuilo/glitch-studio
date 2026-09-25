/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType } from './data-type.ts';
import type { FitMode, WrapMode } from './types.ts';

type ParameterDefinitionBase<T extends DataType> = {
	dataType: T;
	ui: { label: string };
	defaultValue: { inputSource: 'literal'; value: any };
};

// UIの範囲・刻みは入力操作用であり、式やノードから取得した値を制限しない。
export type ScalarParamUi =
	// あくまで「UI上ではこれくらいの範囲でスライダーを操作できると便利」を示すもので、必ずこの範囲内に値が設定されることを要求するものではない
	| { control: 'number'; min?: number; max?: number; step?: number }
	| { control: 'range'; min: number; max: number; step?: number }
	// -1〜+1を-180〜+180度として表示する。保存値の規約はコントロールによらない。
	| { control: 'angle'; step?: number }
	| { control: 'seed' };

export type ParameterDefinition_Scalar = ParameterDefinitionBase<'scalar'> & {
	ui: ScalarParamUi;
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: number };
};
export type ParameterDefinition_Boolean = ParameterDefinitionBase<'bool'> & {
	ui: { control: 'bool' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: boolean };
};
export type ParameterDefinition_Color = ParameterDefinitionBase<'color'> & {
	ui: { control: 'color'; asRgbSwitch?: boolean };
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: [number, number, number, number] };
};
export type ParameterDefinition_Vector = ParameterDefinitionBase<'vector'> & {
	ui: { control: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number };
	canNode?: boolean;
	defaultValue: { inputSource: 'literal'; value: [number, number] };
};
export type ParameterDefinition_BlendMode = ParameterDefinitionBase<'blendMode'> & {
	ui: { control: 'blendMode' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: string }; // TODO
};
export type ParameterDefinition_FitMode = ParameterDefinitionBase<'fitMode'> & {
	ui: { control: 'fitMode' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: FitMode };
};
export type ParameterDefinition_WrapMode = ParameterDefinitionBase<'wrapMode'> & {
	ui: { control: 'wrapMode' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: WrapMode };
};
export type ParameterDefinition_Enum<Options extends readonly { value: string | number | null; label: string }[] = any> = ParameterDefinitionBase<'enum'> & {
	ui: { control: 'enum' };
	options: Options;
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: Options[number]['value'] };
};
export type ParameterDefinition_AssetReference = ParameterDefinitionBase<'assetReference'> & {
	ui: { control: 'image' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
};
export type ParameterDefinition_PlayerReference = ParameterDefinitionBase<'playerReference'> & {
	ui: { control: 'player' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
};
export type ParameterDefinition_VideoAssetReference = ParameterDefinitionBase<'videoAssetReference'> & {
	ui: { control: 'videoAsset' };
	canNode?: false;
	defaultValue: { inputSource: 'literal'; value: null };
};
export type ParameterDefinition_Struct = ParameterDefinitionBase<'struct'> & {
	canNode?: false;
	fields: Record<string, ParameterDefinition>;
	defaultValue: { inputSource: 'literal'; value: Record<string, any> }; // TODO
};
export type ParameterDefinition_Array = ParameterDefinitionBase<'array'> & {
	canNode?: false;
	item: ParameterDefinition;
	defaultValue: { inputSource: 'literal'; value: any[] }; // TODO
};

// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type ParameterDefinition_Any = ParameterDefinitionBase<'any'> & {
	ui: { control: 'none' };
	canNode: true;
	// 4成分は色ではなくデータとして扱う。nullは未接続と同じゼロ値を表す。
	defaultValue: { inputSource: 'literal'; value: [number, number, number, number] | null };
};

export type ParameterDefinition =
	| ParameterDefinition_Scalar | ParameterDefinition_Boolean | ParameterDefinition_Color | ParameterDefinition_Vector
	| ParameterDefinition_BlendMode | ParameterDefinition_FitMode | ParameterDefinition_WrapMode | ParameterDefinition_Enum
	| ParameterDefinition_AssetReference | ParameterDefinition_VideoAssetReference | ParameterDefinition_PlayerReference | ParameterDefinition_Struct | ParameterDefinition_Array | ParameterDefinition_Any;
