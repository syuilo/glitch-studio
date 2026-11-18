import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { EffectDefinition } from '../effect-definition.ts';

export type CustomShaderEffect = EffectDefinition & {
	code: string;
	paramDefs: Readonly<Record<string, ParameterDefinition<TextureDataType> & { canNode: true }>>;
	/** 配線はキーとなるポートIDを使い、WGSL生成時だけ対応する識別子を使う。 */
	inputNames: Readonly<Record<string, string>>;
	outputNames: Readonly<Record<string, string>>;
};
