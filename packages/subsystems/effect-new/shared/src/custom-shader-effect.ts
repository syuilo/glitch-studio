import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectDefinition, EffectParameterDefinition } from './effect-definition.ts';

export interface CustomShaderEffect extends EffectDefinition {
	readonly shaderApiVersion: 1;
	readonly code: string;
	readonly paramDefs: Readonly<Record<string, EffectParameterDefinition<TextureDataType> & { canNode: true; nameForReference: string }>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; nameForReference: string; label?: string }>>;
}
