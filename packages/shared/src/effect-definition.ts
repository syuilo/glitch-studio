import type { DataType, TextureDataType } from './data-type.ts';
import type { EffectParamValue, GsEffectNode, NodeParamValue } from './types.ts';
import type { GlobalEnvVariable } from './expression.ts';

type EffectOptionSchemaBase<T extends DataType> = {
	dataType: T;
	ui: { label: string };
	primary?: boolean;
	visibility?: (state: Record<string, import('./types.ts').EffectParamValue>) => boolean;
};

// UIの範囲・刻みは入力操作用であり、式やノードから取得した値を制限しない。
export type ScalarParamUi =
	// あくまで「UI上ではこれくらいの範囲でスライダーを操作できると便利」を示すもので、必ずこの範囲内に値が設定されることを要求するものではない
	| { control: 'number'; min?: number; max?: number; step?: number }
	| { control: 'range'; min: number; max: number; step?: number }
	// -1〜+1を-180〜+180度として表示する。保存値の規約はコントロールによらない。
	| { control: 'angle'; step?: number }
	| { control: 'seed' };

export type ScalarOptionSchema = EffectOptionSchemaBase<'scalar'> & {
	ui: ScalarParamUi;
	canNode?: boolean;
};
export type BooleanOptionSchema = EffectOptionSchemaBase<'bool'> & {
	ui: { control: 'bool' };
	canNode?: false;
};
export type ColorOptionSchema = EffectOptionSchemaBase<'color'> & {
	ui: { control: 'color'; asRgbSwitch?: boolean };
	canNode?: boolean;
};
export type VectorOptionSchema = EffectOptionSchemaBase<'vector'> & {
	ui: { control: 'vector' | 'xy' | 'wh'; min?: number; max?: number; step?: number };
	canNode?: boolean;
};
export type BlendModeOptionSchema = EffectOptionSchemaBase<'blendMode'> & {
	ui: { control: 'blendMode' };
	canNode?: false;
};
export type FitModeOptionSchema = EffectOptionSchemaBase<'fitMode'> & {
	ui: { control: 'fitMode' };
	canNode?: false;
};
export type WrapModeOptionSchema = EffectOptionSchemaBase<'wrapMode'> & {
	ui: { control: 'wrapMode' };
	canTransparent?: boolean;
	canNode?: false;
};
export type WrapModeValue<T extends WrapModeOptionSchema> = 'clampToEdge' | 'repeat' | 'repeatMirrored'
	| ('canTransparent' extends keyof T ? true extends T['canTransparent'] ? 'transparent' : never : never);

export type EnumOptionSchema = EffectOptionSchemaBase<'enum'> & {
	ui: { control: 'enum' };
	options: readonly { value: string | number | null; label: string }[];
	canNode?: false;
};
export type AssetReferenceOptionSchema = EffectOptionSchemaBase<'assetReference'> & {
	ui: { control: 'image' };
	canNode?: false;
};
export type PlayerReferenceOptionSchema = EffectOptionSchemaBase<'playerReference'> & {
	ui: { control: 'player' };
	canNode?: false;
};
export type VideoAssetReferenceOptionSchema = EffectOptionSchemaBase<'videoAssetReference'> & {
	ui: { control: 'videoAsset' };
	canNode?: false;
};
export type StructOptionSchema = EffectOptionSchemaBase<'struct'> & {
	canNode?: false;
	fields: EffectOptionsSchemaWithDefaults;
};
export type ArrayOptionSchema = EffectOptionSchemaBase<'array'> & {
	canNode?: false;
	item: EffectOptionsSchemaWithDefaults[string];
};

// 入力チャンネルをそのまま扱う汎用データ処理用。リテラルの編集UIは持たない。
export type AnyOptionSchema = EffectOptionSchemaBase<'any'> & {
	ui: { control: 'none' };
	canNode: true;
};

export type EffectOptionSchema =
	| ScalarOptionSchema | BooleanOptionSchema | ColorOptionSchema | VectorOptionSchema
	| BlendModeOptionSchema | FitModeOptionSchema | WrapModeOptionSchema | EnumOptionSchema
	| AssetReferenceOptionSchema | VideoAssetReferenceOptionSchema | PlayerReferenceOptionSchema | StructOptionSchema | ArrayOptionSchema | AnyOptionSchema;
export type EffectOptionsSchema = Record<string, EffectOptionSchema>;

// 外部パラメータも同じdataType/UIの組み合わせを使う。ノード入力の許可はモジュール側が指定する。
type ExternalParameterSchema<T = Exclude<EffectOptionSchema, StructOptionSchema | ArrayOptionSchema | AnyOptionSchema>> =
	T extends unknown ? Omit<T, 'canNode' | 'primary' | 'visibility'> : never;

export type VisualModuleParamDef = ExternalParameterSchema & {
	id: string;
	name: string;
	defaultValue: { inputSource: 'literal'; value: any };
	canNode: boolean;
	isPrimaryInput: boolean;
};

// A type parameter distributes the conditional over unions of option schemas.
type EffectOptionScalarValue<T extends EffectOptionsSchema[string]> =
	T extends AnyOptionSchema ? null :
	T extends ScalarOptionSchema ? number :
	T extends BooleanOptionSchema ? boolean :
	T extends ColorOptionSchema ? Readonly<[number, number, number, number]> :
	T extends VectorOptionSchema ? Readonly<[number, number]> :
	T extends BlendModeOptionSchema ? string :
	T extends FitModeOptionSchema ? 'stretch' | 'cover' | 'contain' :
	T extends WrapModeOptionSchema ? WrapModeValue<T> :
	T extends EnumOptionSchema ? T['options'][number]['value'] :
	T extends AssetReferenceOptionSchema ? string | null :
	T extends VideoAssetReferenceOptionSchema ? string | null :
	T extends PlayerReferenceOptionSchema ? string | null :
	T extends StructOptionSchema ? {
		[K in keyof T['fields']]: EffectOptionDefaultValue<T['fields'][K]>;
	} :
	never;

type EffectOptionValue<T extends EffectOptionsSchema[string]> = T extends unknown ?
	T extends ArrayOptionSchema ? EffectOptionValue<T['item']>[] : EffectOptionScalarValue<T> :
	never;

export type GetEffectOptionsSchemaValues<T extends EffectOptionsSchema> = {
	[K in keyof T]: EffectOptionValue<T[K]>;
};

type EffectOptionSerializedValue<T extends EffectOptionsSchema[string]> =
	{ inputSource: 'literal'; value: EffectOptionScalarValue<T> } |
	{ inputSource: 'envVariable'; variable: GlobalEnvVariable } |
	{ inputSource: 'expression'; expression: string } |
	Extract<EffectParamValue, { inputSource: 'automationGraphReference' | 'automationGraphInline' }> |
	NodeParamValue;

type EffectOptionDefaultValue<T extends EffectOptionsSchema[string]> = T extends unknown ?
	T extends ArrayOptionSchema ? { inputSource: 'literal'; value: EffectOptionDefaultValue<T['item']>[] } :
	T extends StructOptionSchema ? { inputSource: 'literal'; value: EffectOptionScalarValue<T> } :
	EffectOptionSerializedValue<T> :
	never;

type EffectOptionsSchemaDefaultValue<T extends EffectOptionsSchema, K extends keyof T> =
	EffectOptionDefaultValue<T[K]>;

// デフォルト値にも、パラメータの種類に応じた型を付ける。
type EffectOptionSchemaWithDefault<T extends EffectOptionsSchema[string]> = T extends unknown ? T & {
	defaultValue: EffectOptionsSchemaDefaultValue<{ param: T }, 'param'>;
} : never;

type EffectOptionsSchemaWithDefaults = Record<string, EffectOptionSchemaWithDefault<EffectOptionsSchema[string]>>;

type EffectOptionsSchemaDefaults<T extends EffectOptionsSchema> = {
	[K in keyof T]: { defaultValue: EffectOptionsSchemaDefaultValue<NoInfer<T>, K> };
};

export type EffectOutputsSchema = Record<string, {
	dataType: TextureDataType;
	primary: boolean;
	// trueの出力のみ、必要になるまで確保を遅らせ、未使用になったら解放する。
	canLazyAllocation?: boolean;
}>;

export type EffectTags = string; // TODO

export type EffectDefinition<OpSc extends EffectOptionsSchema = EffectOptionsSchema, Outputs extends EffectOutputsSchema = EffectOutputsSchema> = {
	id: string;
	displayName: string;
	tags: EffectTags[];
	paramDefs: OpSc;
	outputs: Outputs;
};

export type EffectNodeOf<DEF extends EffectDefinition> = Omit<GsEffectNode, 'effectId' | 'params'> & {
	effectId: DEF['id'];
	params: {
		[K in keyof DEF['paramDefs']]-?: EffectOptionDefaultValue<DEF['paramDefs'][K]>;
	};
};

export function defineEffect<const OpSc extends Record<string, EffectOptionSchemaWithDefault<EffectOptionsSchema[string]>>, const Outputs extends EffectOutputsSchema>(
	def: EffectDefinition<OpSc, Outputs> & { paramDefs: EffectOptionsSchemaDefaults<OpSc> },
): EffectDefinition<OpSc, Outputs> {
	return def;
}
