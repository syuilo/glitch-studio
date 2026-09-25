/* eslint-disable @typescript-eslint/naming-convention */
import type { DataType } from './data-type.ts';

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
};
export type ParameterDefinition_Boolean = ParameterDefinitionBase<'bool'> & {
	ui: { control: 'bool' };
	canNode?: false;
};
export type ParameterDefinition_Color = ParameterDefinitionBase<'color'> & {
	ui: { control: 'color'; asRgbSwitch?: boolean };
	canNode?: boolean;
};
export type ParameterDefinition_Vector = ParameterDefinitionBase<'vector'> & {
	ui: { control: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number };
	canNode?: boolean;
};
export type ParameterDefinition_BlendMode = ParameterDefinitionBase<'blendMode'> & {
	ui: { control: 'blendMode' };
	canNode?: false;
};
export type ParameterDefinition_FitMode = ParameterDefinitionBase<'fitMode'> & {
	ui: { control: 'fitMode' };
	canNode?: false;
};
export type ParameterDefinition_WrapMode = ParameterDefinitionBase<'wrapMode'> & {
	ui: { control: 'wrapMode' };
	canNode?: false;
};
export type ParameterDefinition_Enum = ParameterDefinitionBase<'enum'> & {
	ui: { control: 'enum' };
	options: readonly { value: string | number | null; label: string }[];
	canNode?: false;
};
export type ParameterDefinition_AssetReference = ParameterDefinitionBase<'assetReference'> & {
	ui: { control: 'image' };
	canNode?: false;
};
export type ParameterDefinition_PlayerReference = ParameterDefinitionBase<'playerReference'> & {
	ui: { control: 'player' };
	canNode?: false;
};
export type ParameterDefinition_VideoAssetReference = ParameterDefinitionBase<'videoAssetReference'> & {
	ui: { control: 'videoAsset' };
	canNode?: false;
};
export type ParameterDefinition_Struct = ParameterDefinitionBase<'struct'> & {
	canNode?: false;
	fields: Record<string, ParameterDefinition>;
};
export type ParameterDefinition_Array = ParameterDefinitionBase<'array'> & {
	canNode?: false;
	item: ParameterDefinition;
};

// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type ParameterDefinition_Any = ParameterDefinitionBase<'any'> & {
	ui: { control: 'none' };
	canNode: true;
};

export type ParameterDefinition =
	| ParameterDefinition_Scalar | ParameterDefinition_Boolean | ParameterDefinition_Color | ParameterDefinition_Vector
	| ParameterDefinition_BlendMode | ParameterDefinition_FitMode | ParameterDefinition_WrapMode | ParameterDefinition_Enum
	| ParameterDefinition_AssetReference | ParameterDefinition_VideoAssetReference | ParameterDefinition_PlayerReference | ParameterDefinition_Struct | ParameterDefinition_Array | ParameterDefinition_Any;
