import { effectSourceSchema } from './effect-source-schema.ts';
import { z } from 'zod';
import { curveAnimationSchema, effectResolutionSchema, fitModeSchema, identifierSchema, parameterDefinitionSchema, parameterPathSchema, staticSettingValuesSchema, textureDataTypeSchema, valueParameterBindingSchema, valueParameterSourceSchema, wrapModeSchema } from './parameter-contract-schemas.ts';
import type { NodesEffect, NodesEffectNode, NodesEffectParameterBinding, NodesEffectValueParameterBinding, NodesEffectNodeParameterBinding, NodesEffectParamDef, NodesEffectCustomParameterDefinition } from '@/types/nodes-effect-view.ts';

export const registeredNodesEffectTargetSchema = z.object({ nodesEffectId: identifierSchema });
export const nodesEffectTargetSchema = z.union([
	registeredNodesEffectTargetSchema,
	z.object({ sceneId: identifierSchema, layerId: identifierSchema }),
]).describe('A registered Nodes Effect or an inline Nodes Effect owned by a Timeline layer. Pass the target returned by Query or Command.');
export const nodesEffectNodeReferenceSchema = z.object({ nodesEffect: nodesEffectTargetSchema, nodeId: identifierSchema });
export const nodesEffectNodeParameterReferenceSchema = z.object({ target: nodesEffectNodeReferenceSchema, parameterPath: parameterPathSchema });
export const nodesEffectPublicParameterIdSchema = z.string();
export const nodesEffectCustomParameterIdSchema = z.string();
const nodesEffectPublicParameterNameSchema = z.string();
const nodesEffectCustomParameterNameSchema = z.string();
export const nodesEffectPublicParameterReferenceSchema = z.object({ nodesEffect: nodesEffectTargetSchema, parameterId: nodesEffectPublicParameterIdSchema });
export const nodesEffectCustomParameterReferenceSchema = z.object({ nodesEffect: nodesEffectTargetSchema, parameterId: nodesEffectCustomParameterIdSchema });
export const nodesEffectOutputReferenceSchema = z.object({ nodesEffect: nodesEffectTargetSchema, outputId: identifierSchema });

export const nodesEffectNodeOutputReferenceSchema = z.object({ nodeId: z.string(), outputPort: z.string() });
const unconnectedOutputSchema = z.object({ nodeId: z.null(), outputPort: z.null() });
export const nodesEffectNodeOutputConnectionSchema = z.union([nodesEffectNodeOutputReferenceSchema, unconnectedOutputSchema]);
// UIの再接続もサンプリング設定を省略できる。型付きの保存表現に合わせて必須にすると
// 既存のCommand経路を拒否してしまうため、境界ではrendererが扱う省略形を受け入れる。
const nodeParameterBindingSchema = z.union([
	z.object({ inputSource: z.literal('node'), nodeId: z.string(), outputPort: z.string(), fitMode: fitModeSchema.optional(), wrapMode: wrapModeSchema.optional(), filterMode: z.enum(['linear', 'nearest']).optional() }),
	z.object({ inputSource: z.literal('node'), nodeId: z.null(), outputPort: z.null() }),
]) as z.ZodType<NodesEffectNodeParameterBinding>;
const publicParameterBindingSchema = z.object({ inputSource: z.literal('nodesEffectPublicParameterReference'), parameterId: nodesEffectPublicParameterIdSchema });
const customParameterBindingSchema = z.object({ inputSource: z.literal('nodesEffectCustomParameterValueReference'), parameterId: nodesEffectCustomParameterIdSchema });
export const nodesEffectValueParameterBindingSchema: z.ZodType<NodesEffectValueParameterBinding> = z.union([valueParameterBindingSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const nodesEffectParameterBindingSchema: z.ZodType<NodesEffectParameterBinding> = z.union([nodesEffectValueParameterBindingSchema, nodeParameterBindingSchema])
	.describe('Binding stored on a Nodes Effect parameter. Literal shape and available sources depend on the parameter definition.');
export const nodesEffectValueParameterSourceSchema = z.union([valueParameterSourceSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const nodesEffectParameterSourceSchema = z.union([nodesEffectValueParameterSourceSchema, nodeParameterBindingSchema]);
export const nodesEffectParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'curveAnimationReference', 'curveAnimationInline', 'keyframesTimelineInline', 'nodesEffectPublicParameterReference', 'nodesEffectCustomParameterValueReference', 'node']);
export const nodesEffectValueParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'curveAnimationReference', 'curveAnimationInline', 'keyframesTimelineInline', 'nodesEffectPublicParameterReference', 'nodesEffectCustomParameterValueReference']);

export const nodesEffectPublicParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: nodesEffectPublicParameterNameSchema, canNode: z.boolean() })) as z.ZodType<Omit<NodesEffectParamDef, 'id'>>;
export const nodesEffectPublicParameterDefinitionSchema = z.intersection(nodesEffectPublicParameterInputSchema,
	z.object({ id: nodesEffectPublicParameterIdSchema })) as z.ZodType<NodesEffectParamDef>;
export const nodesEffectCustomParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: nodesEffectCustomParameterNameSchema, canNode: z.literal(false), dataType: z.object({ kind: z.enum(['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference']) }) })) as z.ZodType<Omit<NodesEffectCustomParameterDefinition, 'id'>>;
export const nodesEffectCustomParameterDefinitionSchema = z.intersection(nodesEffectCustomParameterInputSchema,
	z.object({ id: nodesEffectCustomParameterIdSchema })) as z.ZodType<NodesEffectCustomParameterDefinition>;
export const nodesEffectOutputInputSchema = z.object({ label: z.string(), name: z.string(), dataType: textureDataTypeSchema });
export const nodesEffectOutputDefinitionSchema = nodesEffectOutputInputSchema.extend({ id: z.string() });
const positionSchema = z.object({ x: z.number(), y: z.number() });
export const nodesEffectNodeSchema: z.ZodType<NodesEffectNode> = z.union([
	z.object({
		id: z.string(), type: z.literal('effect'), effectSource: effectSourceSchema, isBypass: z.boolean(), resolution: effectResolutionSchema,
		params: z.record(z.string(), nodesEffectParameterBindingSchema), staticSettings: staticSettingValuesSchema, displayName: z.string(), pos: positionSchema.optional(),
	}),
	z.object({ id: z.string(), type: z.literal('globalIn'), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('globalOut'), inputs: z.record(z.string(), nodesEffectNodeOutputConnectionSchema), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('relay'), label: z.string().optional(), dataType: textureDataTypeSchema, input: nodesEffectNodeOutputConnectionSchema, pos: positionSchema.optional() }),
]);
export const nodesEffectSchema: z.ZodType<NodesEffect> = z.object({
	resolutionInputParameters: z.array(z.string()),
	nodes: z.array(nodesEffectNodeSchema), outputDefs: z.array(nodesEffectOutputDefinitionSchema), primaryOutputId: z.string().nullable(),
	paramDefs: z.array(nodesEffectPublicParameterDefinitionSchema), customParameterDefs: z.array(nodesEffectCustomParameterDefinitionSchema),
	customParameterValues: z.record(nodesEffectCustomParameterIdSchema, nodesEffectValueParameterBindingSchema),
	primaryInputId: nodesEffectPublicParameterIdSchema.nullable(), primaryAudioInputId: nodesEffectPublicParameterIdSchema.nullish(), curveAnimations: z.array(curveAnimationSchema),
});
