import type { TextureDataType } from '../data-type.ts';
import type { GlobalEnvVariable } from '../expression.ts';
import type { ParameterDefinition, ParameterDefinition_Any, ParameterDefinition_Array, ParameterDefinition_AssetReference, ParameterDefinition_BlendMode, ParameterDefinition_Boolean, ParameterDefinition_Color, ParameterDefinition_Enum, ParameterDefinition_FitMode, ParameterDefinition_PlayerReference, ParameterDefinition_Scalar, ParameterDefinition_Struct, ParameterDefinition_Vector, ParameterDefinition_VideoAssetReference, ParameterDefinition_WrapMode } from '../parameter.ts';
import type { FitMode, ParameterBinding, ParameterBinding_Node, WrapMode } from '../types.ts';

// A type parameter distributes the conditional over unions of option schemas.
type EffectOptionScalarValue<T extends ParameterDefinition> =
	T extends ParameterDefinition_Any ? null :
	T extends ParameterDefinition_Scalar ? number :
	T extends ParameterDefinition_Boolean ? boolean :
	T extends ParameterDefinition_Color ? Readonly<[number, number, number, number]> :
	T extends ParameterDefinition_Vector ? Readonly<[number, number]> :
	T extends ParameterDefinition_BlendMode ? string :
	T extends ParameterDefinition_FitMode ? FitMode :
	T extends ParameterDefinition_WrapMode ? WrapMode :
	T extends ParameterDefinition_Enum ? T['options'][number]['value'] :
	T extends ParameterDefinition_AssetReference ? string | null :
	T extends ParameterDefinition_VideoAssetReference ? string | null :
	T extends ParameterDefinition_PlayerReference ? string | null :
	T extends ParameterDefinition_Struct ? {
		[K in keyof T['fields']]: EffectOptionDefaultValue<T['fields'][K]>;
	} :
	never;

export type EffectOutputDefinitions = Record<string, {
	dataType: TextureDataType;
	primary: boolean;
	// trueの出力のみ、必要になるまで確保を遅らせ、未使用になったら解放する。
	canLazyAllocation?: boolean;
}>;

export type EffectTags = string; // TODO

export type EffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions> = {
	id: string;
	displayName: string;
	tags: EffectTags[];
	paramDefs: In;
	outputDefs: Out;
};

export function defineEffect<const In extends Record<string, ParameterDefinition>, const Out extends EffectOutputDefinitions>(
	def: EffectDefinition<In, Out>,
): EffectDefinition<In, Out> {
	return def;
}
