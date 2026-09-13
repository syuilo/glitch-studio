import type { NodeOutputReference, NodeParamValue } from './types.ts';

export type NumberOptionSchema = {
	type: 'number';
	label: string;
	min?: number;
	max?: number;
	step?: number;
	canNode?: boolean;
};

export type BooleanOptionSchema = {
	type: 'bool';
	label: string;
	canNode?: false;
};

export type ColorOptionSchema = {
	type: 'color';
	label: string;
	canNode?: false;
};

export type VectorOptionSchema = {
	type: 'vector';
	label: string;
	min?: number;
	max?: number;
	step?: number;
	canNode?: boolean;
};

export type SignalOptionSchema = {
	type: 'signal';
	label: string;
	canNode?: false;
};

export type BlendModeOptionSchema = {
	type: 'blendMode';
	label: string;
	canNode?: false;
};

export type FitModeOptionSchema = {
	type: 'fitMode';
	label: string;
	canNode?: false;
};

export type WrapModeOptionSchema = {
	type: 'wrapMode';
	label: string;
	canTransparent?: boolean;
	canNode?: false;
};

export type WrapModeValue<T extends WrapModeOptionSchema> = 'clampToEdge' | 'repeat' | 'repeatMirrored'
	| ('canTransparent' extends keyof T ? true extends T['canTransparent'] ? 'transparent' : never : never);

export type SeedOptionSchema = {
	type: 'seed';
	label: string;
	canNode?: false;
};

export type EnumOptionSchema = {
	type: 'enum';
	label: string;
	options: readonly {
		value: string | number | null;
		label: string;
	}[];
	canNode?: false;
};

export type RangeOptionSchema = {
	type: 'range';
	label: string;
	min: number;
	max: number;
	step?: number;
	canNode?: boolean;
};

export type ImageOptionSchema = {
	type: 'image';
	label: string;
	canNode?: false;
};

export type PlayerOptionSchema = {
	type: 'player';
	label: string;
	canNode?: false;
};

export type NodeOptionSchema = {
	type: 'node';
	label: string;
	dataType: 'color' | 'scalar' | 'vector' | 'any';
	primary?: boolean;
	canNode?: false;
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
	ImageOptionSchema |
	PlayerOptionSchema |
	NodeOptionSchema
>;

// A type parameter distributes the conditional over unions of option schemas.
type EffectOptionValue<T extends EffectOptionsSchema[string]> =
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
	T extends ImageOptionSchema ? null :
	T extends PlayerOptionSchema ? null :
	T extends NodeOptionSchema ? NodeOutputReference | null :
	never;

export type GetEffectOptionsSchemaValues<T extends EffectOptionsSchema> = {
	[K in keyof T]: EffectOptionValue<T[K]>;
};

type EffectOptionsSchemaDefaultValue<T extends EffectOptionsSchema, K extends keyof T> =
	{ type: 'literal'; value: GetEffectOptionsSchemaValues<T>[K] } |
	{ type: 'expression'; expression: string } |
	{ type: 'automation'; automationId: string | null } |
	NodeParamValue;

// コールバックの戻り値にも、パラメータの種類に応じた型を付ける。
type EffectOptionSchemaWithDefault<T extends EffectOptionsSchema[string]> = T extends unknown ? T & {
	default: () => EffectOptionsSchemaDefaultValue<{ param: T }, 'param'>;
} : never;

type EffectOptionsSchemaDefaults<T extends EffectOptionsSchema> = {
	[K in keyof T]: { default: () => EffectOptionsSchemaDefaultValue<NoInfer<T>, K> };
};

export type EffectOutputsSchema = Record<string, { dataType: 'color' | 'scalar' | 'vector' | 'any'; primary: boolean; }>;

export type EffectDefinition<OpSc extends EffectOptionsSchema = EffectOptionsSchema, Outputs extends EffectOutputsSchema = EffectOutputsSchema> = {
	name: string;
	displayName: string;
	category: string;
	paramDefs: OpSc;
	outputs: Outputs;
};

export function defineEffect<const OpSc extends Record<string, EffectOptionSchemaWithDefault<EffectOptionsSchema[string]>>, const Outputs extends EffectOutputsSchema>(
	def: EffectDefinition<OpSc, Outputs> & { paramDefs: EffectOptionsSchemaDefaults<OpSc> },
): EffectDefinition<OpSc, Outputs> {
	return def;
}
