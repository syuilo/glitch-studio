import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition, EffectOutputDefinition } from '../effect-definition.ts';

export type CustomShaderEffectParameterDefinition = ParameterDefinition<TextureDataType> & {
	canNode: true;
	nameForReference: string;
};

export type CustomShaderEffectOutputDefinition = EffectOutputDefinition & { nameForReference: string };

export type CustomShaderEffect = EffectDefinition<
	Record<string, CustomShaderEffectParameterDefinition>,
	Record<string, CustomShaderEffectOutputDefinition>
> & {
	shaderApiVersion: 1;
	code: string;
};
