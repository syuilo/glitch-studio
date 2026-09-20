import type { GsEffectNode, NodeParamValue } from './types.ts';

type EffectOptionSchemaBase = {
	label: string;
};

export type NumberOptionSchema = EffectOptionSchemaBase & {
	type: 'number';
	min?: number;
	max?: number;
	step?: number;
	canNode?: boolean;
};

export type BooleanOptionSchema = EffectOptionSchemaBase & {
	type: 'bool';
	canNode?: false;
};

// -1〜+1を-180〜+180度として扱う角度。正の値は画面上で時計回り。
export type AngleOptionSchema = EffectOptionSchemaBase & {
	type: 'angle';
	step?: number;
	canNode?: boolean;
};

export type ColorOptionSchema = EffectOptionSchemaBase & {
	type: 'color';
	asRgbSwitch?: boolean;
	canNode?: boolean;
};

export type VectorOptionSchema = EffectOptionSchemaBase & {
	type: 'vector';
	min?: number;
	max?: number;
	step?: number;
	canNode?: boolean;
};

export type BlendModeOptionSchema = EffectOptionSchemaBase & {
	type: 'blendMode';
	canNode?: false;
};

export type FitModeOptionSchema = EffectOptionSchemaBase & {
	type: 'fitMode';
	canNode?: false;
};

export type WrapModeOptionSchema = EffectOptionSchemaBase & {
	type: 'wrapMode';
	canTransparent?: boolean;
	canNode?: false;
};

export type WrapModeValue<T extends WrapModeOptionSchema> = 'clampToEdge' | 'repeat' | 'repeatMirrored'
	| ('canTransparent' extends keyof T ? true extends T['canTransparent'] ? 'transparent' : never : never);

export type SeedOptionSchema = EffectOptionSchemaBase & {
	type: 'seed';
	canNode?: false;
};

export type EnumOptionSchema = EffectOptionSchemaBase & {
	type: 'enum';
	options: readonly {
		value: string | number | null;
		label: string;
	}[];
	canNode?: false;
};

export type RangeOptionSchema = EffectOptionSchemaBase & {
	type: 'range';

	// あくまで「UI上ではこれくらいの範囲でスライダーを操作できると便利」を示すもので、必ずこの範囲内に値が設定されることを要求するものではない
	min: number;
	max: number;
	step?: number;
	canNode?: boolean;
};

export type ImageOptionSchema = EffectOptionSchemaBase & {
	type: 'image';
	canNode?: false;
};

export type PlayerOptionSchema = EffectOptionSchemaBase & {
	type: 'player';
	canNode?: false;
};

export type StructOptionSchema = EffectOptionSchemaBase & {
	type: 'struct';
	fields: EffectOptionsSchemaWithDefaults;
};

export type ArrayOptionSchema = EffectOptionSchemaBase & {
	type: 'array';
	item: EffectOptionsSchemaWithDefaults[string];
};

export type EffectOptionsSchema = Record<string,
	NumberOptionSchema |
	BooleanOptionSchema |
	ColorOptionSchema |
	VectorOptionSchema |
	SignalOptionSchema |
	BlendModeOptionSchema |
	FitModeOptionSchema |
	WrapModeOptionSchema |
	SeedOptionSchema |
	EnumOptionSchema |
	RangeOptionSchema |
	AngleOptionSchema |
	ImageOptionSchema |
	PlayerOptionSchema |
	StructOptionSchema |
	ArrayOptionSchema
>;

// A type parameter distributes the conditional over unions of option schemas.
type EffectOptionScalarValue<T extends EffectOptionsSchema[string]> =
	T extends NumberOptionSchema ? number :
	T extends BooleanOptionSchema ? boolean :
	T extends ColorOptionSchema ? Readonly<[number, number, number, number]> :
	T extends VectorOptionSchema ? Readonly<[number, number]> :
	T extends SignalOptionSchema ? Readonly<[boolean, boolean, boolean]> :
	T extends BlendModeOptionSchema ? string :
	T extends FitModeOptionSchema ? 'stretch' | 'cover' | 'contain' :
	T extends WrapModeOptionSchema ? WrapModeValue<T> :
	T extends SeedOptionSchema ? number :
	T extends EnumOptionSchema ? T['options'][number]['value'] :
	T extends RangeOptionSchema ? number :
	T extends AngleOptionSchema ? number :
	T extends ImageOptionSchema ? string | null :
	T extends PlayerOptionSchema ? string | null :
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
	{ inputSource: 'envVariable'; variable: string } |
	{ inputSource: 'expression'; expression: string } |
	{ inputSource: 'automation'; automationId: string | null } |
	NodeParamValue;

type EffectOptionDefaultValue<T extends EffectOptionsSchema[string]> = T extends unknown ?
	T extends ArrayOptionSchema ? { inputSource: 'literal'; value: EffectOptionDefaultValue<T['item']>[] } :
	T extends StructOptionSchema ? { inputSource: 'literal'; value: EffectOptionScalarValue<T> } :
	EffectOptionSerializedValue<T> :
	never;

type EffectOptionsSchemaDefaultValue<T extends EffectOptionsSchema, K extends keyof T> =
	EffectOptionDefaultValue<T[K]>;

// コールバックの戻り値にも、パラメータの種類に応じた型を付ける。
type EffectOptionSchemaWithDefault<T extends EffectOptionsSchema[string]> = T extends unknown ? T & {
	default: () => EffectOptionsSchemaDefaultValue<{ param: T }, 'param'>;
} : never;

type EffectOptionsSchemaWithDefaults = Record<string, EffectOptionSchemaWithDefault<EffectOptionsSchema[string]>>;

type EffectOptionsSchemaDefaults<T extends EffectOptionsSchema> = {
	[K in keyof T]: { default: () => EffectOptionsSchemaDefaultValue<NoInfer<T>, K> };
};

export type EffectOutputsSchema = Record<string, {
	dataType: 'color' | 'scalar' | 'vector' | 'any';
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
