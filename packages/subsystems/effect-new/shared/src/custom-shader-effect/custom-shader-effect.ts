import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition, EffectOutputDefinition } from '../effect-definition.ts';

type CustomShaderEffectParameter = ParameterDefinition<TextureDataType> & {
	canNode: true;
	nameForReference: string;
};

/** WGSLの参照名はポートの固定IDと独立して変更できる。入出力定義はUIと実装で共有する。 */
export type CustomShaderEffect = EffectDefinition<
	Readonly<Record<string, CustomShaderEffectParameter>>,
	Readonly<Record<string, EffectOutputDefinition & { nameForReference: string }>>
> & {
	staticSettingDefs?: never;
	codeLanguage: 'wgsl';
	shaderApiVersion: 1;
	code: string;
};
