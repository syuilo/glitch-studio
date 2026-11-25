import { z } from 'zod';
import { customShaderEffectDefinitionSchema } from './project-contract-schemas.ts';
import { curveAnimationSchema, effectResolutionSchema, parameterDefinitionSchema, staticSettingValuesSchema, textureDataTypeSchema, valueParameterBindingSchema } from './parameter-contract-schemas.ts';
import type { EffectSource } from '@gs/subsystems_effect_shared/effect-source.ts';
import type { NodesEffect } from '@gs/subsystems_effect_shared/nodes-effect.ts';

const id = z.string().min(1);
const record = <T extends z.ZodType>(value: T) => z.record(id, value);
const nodeOutput = z.object({ nodeId: id, outputPort: id });
const outputSource = z.union([nodeOutput, z.object({ parameterId: id })]);
export const samplingSchema = z.object({ fitMode: z.enum(['cover', 'contain', 'stretch']), wrapMode: z.enum(['clamp', 'repeat', 'repeatMirrored', 'transparent']), filterMode: z.enum(['linear', 'nearest']) });
const valueBinding = z.union([valueParameterBindingSchema,
	z.object({ inputSource: z.literal('nodesEffectPublicParameterReference'), parameterId: id, sampling: samplingSchema.optional() }),
	z.object({ inputSource: z.literal('nodesEffectCustomParameterValueReference'), parameterId: id }),
]);
const binding = z.union([valueBinding, z.object({ inputSource: z.literal('node'), source: nodeOutput.nullable(), sampling: samplingSchema })]);

export const storedNodesEffectSchema: z.ZodType<NodesEffect> = z.lazy(() => z.looseObject({
	kind: z.enum(['generate', 'modify']), primaryInputParameter: id.nullable(), primaryOutput: id.nullable(), primaryAudioInputParameter: id.nullish(),
	resolutionInputParameters: z.array(id), paramDefs: record(parameterDefinitionSchema), outputDefs: record(z.looseObject({ dataType: textureDataTypeSchema, label: z.string().optional() })),
	customParameterDefs: record(parameterDefinitionSchema).optional(), customParameterValues: record(valueBinding).optional(), curveAnimations: z.array(curveAnimationSchema).optional(),
	outputSources: record(outputSource), nodes: z.array(z.union([
		z.looseObject({ type: z.literal('relay'), id, input: outputSource.nullable(), dataType: textureDataTypeSchema }),
		z.looseObject({ type: z.literal('effect').optional(), id, effectSource: effectSourceSchema, params: record(binding), staticSettings: staticSettingValuesSchema.optional(),
			isBypass: z.boolean().optional(), resolution: z.union([effectResolutionSchema, z.object({ width: z.number(), height: z.number() })]).optional() }),
	])),
})) as unknown as z.ZodType<NodesEffect>;

export const effectSourceSchema: z.ZodType<EffectSource> = z.discriminatedUnion('type', [
	z.object({ type: z.literal('nativeEffect'), id }),
	z.object({ type: z.literal('customShaderEffectReference'), id }),
	z.object({ type: z.literal('inlineCustomShaderEffect'), customShaderEffect: customShaderEffectDefinitionSchema }),
	z.object({ type: z.literal('nodesEffectReference'), id }),
	z.object({ type: z.literal('inlineNodesEffect'), nodesEffect: storedNodesEffectSchema }),
]);
