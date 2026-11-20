import { effectSourceSchema } from './effect-source-schema.ts';
import { z } from 'zod';
import { automationGraphSchema, effectResolutionSchema, fitModeSchema, identifierSchema, parameterDefinitionSchema, parameterPathSchema, staticSettingValuesSchema, textureDataTypeSchema, valueParameterBindingSchema, valueParameterSourceSchema, wrapModeSchema } from './parameter-contract-schemas.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectNode, CustomNodeGraphEffectParameterBinding, CustomNodeGraphEffectValueParameterBinding, CustomNodeGraphEffectNodeParameterBinding, CustomNodeGraphEffectParamDef, CustomNodeGraphEffectCustomParameterDefinition } from '@/types/custom-node-graph-effect-view.ts';

export const registeredCustomNodeGraphEffectTargetSchema = z.object({ customNodeGraphEffectId: identifierSchema });
export const customNodeGraphEffectTargetSchema = z.union([
	registeredCustomNodeGraphEffectTargetSchema,
	z.object({ sceneId: identifierSchema, layerId: identifierSchema }),
]).describe('A registered Custom Node Graph Effect or an inline Custom Node Graph Effect owned by a Timeline layer. Pass the target returned by Query or Command.');
export const customNodeGraphEffectNodeReferenceSchema = z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, nodeId: identifierSchema });
export const customNodeGraphEffectNodeParameterReferenceSchema = z.object({ target: customNodeGraphEffectNodeReferenceSchema, parameterPath: parameterPathSchema });
export const customNodeGraphEffectPublicParameterIdSchema = z.string();
export const customNodeGraphEffectCustomParameterIdSchema = z.string();
const customNodeGraphEffectPublicParameterNameSchema = z.string();
const customNodeGraphEffectCustomParameterNameSchema = z.string();
export const customNodeGraphEffectPublicParameterReferenceSchema = z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, parameterId: customNodeGraphEffectPublicParameterIdSchema });
export const customNodeGraphEffectCustomParameterReferenceSchema = z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, parameterId: customNodeGraphEffectCustomParameterIdSchema });
export const customNodeGraphEffectOutputReferenceSchema = z.object({ customNodeGraphEffect: customNodeGraphEffectTargetSchema, outputId: identifierSchema });

export const customNodeGraphEffectNodeOutputReferenceSchema = z.object({ nodeId: z.string(), outputPort: z.string() });
const unconnectedOutputSchema = z.object({ nodeId: z.null(), outputPort: z.null() });
export const customNodeGraphEffectNodeOutputConnectionSchema = z.union([customNodeGraphEffectNodeOutputReferenceSchema, unconnectedOutputSchema]);
// UIの再接続もサンプリング設定を省略できる。型付きの保存表現に合わせて必須にすると
// 既存のCommand経路を拒否してしまうため、境界ではrendererが扱う省略形を受け入れる。
const nodeParameterBindingSchema = z.union([
	z.object({ inputSource: z.literal('node'), nodeId: z.string(), outputPort: z.string(), fitMode: fitModeSchema.optional(), wrapMode: wrapModeSchema.optional(), filterMode: z.enum(['linear', 'nearest']).optional() }),
	z.object({ inputSource: z.literal('node'), nodeId: z.null(), outputPort: z.null() }),
]) as z.ZodType<CustomNodeGraphEffectNodeParameterBinding>;
const publicParameterBindingSchema = z.object({ inputSource: z.literal('customNodeGraphEffectPublicParameterReference'), parameterId: customNodeGraphEffectPublicParameterIdSchema });
const customParameterBindingSchema = z.object({ inputSource: z.literal('customNodeGraphEffectCustomParameterValueReference'), parameterId: customNodeGraphEffectCustomParameterIdSchema });
export const customNodeGraphEffectValueParameterBindingSchema: z.ZodType<CustomNodeGraphEffectValueParameterBinding> = z.union([valueParameterBindingSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const customNodeGraphEffectParameterBindingSchema: z.ZodType<CustomNodeGraphEffectParameterBinding> = z.union([customNodeGraphEffectValueParameterBindingSchema, nodeParameterBindingSchema])
	.describe('Binding stored on a Custom Node Graph Effect parameter. Literal shape and available sources depend on the parameter definition.');
export const customNodeGraphEffectValueParameterSourceSchema = z.union([valueParameterSourceSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const customNodeGraphEffectParameterSourceSchema = z.union([customNodeGraphEffectValueParameterSourceSchema, nodeParameterBindingSchema]);
export const customNodeGraphEffectParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'customNodeGraphEffectPublicParameterReference', 'customNodeGraphEffectCustomParameterValueReference', 'node']);
export const customNodeGraphEffectValueParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'customNodeGraphEffectPublicParameterReference', 'customNodeGraphEffectCustomParameterValueReference']);

export const customNodeGraphEffectPublicParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: customNodeGraphEffectPublicParameterNameSchema, canNode: z.boolean() })) as z.ZodType<Omit<CustomNodeGraphEffectParamDef, 'id'>>;
export const customNodeGraphEffectPublicParameterDefinitionSchema = z.intersection(customNodeGraphEffectPublicParameterInputSchema,
	z.object({ id: customNodeGraphEffectPublicParameterIdSchema })) as z.ZodType<CustomNodeGraphEffectParamDef>;
export const customNodeGraphEffectCustomParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: customNodeGraphEffectCustomParameterNameSchema, canNode: z.literal(false), dataType: z.object({ kind: z.enum(['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference']) }) })) as z.ZodType<Omit<CustomNodeGraphEffectCustomParameterDefinition, 'id'>>;
export const customNodeGraphEffectCustomParameterDefinitionSchema = z.intersection(customNodeGraphEffectCustomParameterInputSchema,
	z.object({ id: customNodeGraphEffectCustomParameterIdSchema })) as z.ZodType<CustomNodeGraphEffectCustomParameterDefinition>;
export const customNodeGraphEffectOutputInputSchema = z.object({ label: z.string(), name: z.string(), dataType: textureDataTypeSchema });
export const customNodeGraphEffectOutputDefinitionSchema = customNodeGraphEffectOutputInputSchema.extend({ id: z.string() });
const positionSchema = z.object({ x: z.number(), y: z.number() });
export const customNodeGraphEffectNodeSchema: z.ZodType<CustomNodeGraphEffectNode> = z.union([
	z.object({
		id: z.string(), type: z.literal('effect'), effectSource: effectSourceSchema, isBypass: z.boolean(), resolution: effectResolutionSchema,
		params: z.record(z.string(), customNodeGraphEffectParameterBindingSchema), staticSettings: staticSettingValuesSchema, displayName: z.string(), pos: positionSchema.optional(),
	}),
	z.object({ id: z.string(), type: z.literal('globalIn'), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('globalOut'), inputs: z.record(z.string(), customNodeGraphEffectNodeOutputConnectionSchema), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('relay'), label: z.string().optional(), dataType: textureDataTypeSchema, input: customNodeGraphEffectNodeOutputConnectionSchema, pos: positionSchema.optional() }),
]);
export const customNodeGraphEffectSchema: z.ZodType<CustomNodeGraphEffect> = z.object({
	resolutionInputParameters: z.array(z.string()),
	nodes: z.array(customNodeGraphEffectNodeSchema), outputDefs: z.array(customNodeGraphEffectOutputDefinitionSchema), primaryOutputId: z.string().nullable(),
	paramDefs: z.array(customNodeGraphEffectPublicParameterDefinitionSchema), customParameterDefs: z.array(customNodeGraphEffectCustomParameterDefinitionSchema),
	customParameterValues: z.record(customNodeGraphEffectCustomParameterIdSchema, customNodeGraphEffectValueParameterBindingSchema),
	primaryInputId: customNodeGraphEffectPublicParameterIdSchema.nullable(), primaryAudioInputId: customNodeGraphEffectPublicParameterIdSchema.nullish(), automationGraphs: z.array(automationGraphSchema),
});
