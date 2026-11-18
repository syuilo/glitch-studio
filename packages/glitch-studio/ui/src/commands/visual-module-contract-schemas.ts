import { z } from 'zod';
import { automationGraphSchema, effectResolutionSchema, fitModeSchema, identifierSchema, parameterDefinitionSchema, parameterPathSchema, staticSettingValuesSchema, textureDataTypeSchema, valueParameterBindingSchema, valueParameterSourceSchema, wrapModeSchema } from './parameter-contract-schemas.ts';
import type { VisualModule, VisualModuleNode, VisualModuleParameterBinding, VisualModuleValueParameterBinding, VisualModuleNodeParameterBinding, VisualModuleParamDef, VisualModuleCustomParameterDefinition, VisualModulePublicParameterId, VisualModuleCustomParameterId, VisualModulePublicParameterName, VisualModuleCustomParameterName } from '@gs/subsystems_visual-module_shared/types.ts';

export const registeredVisualModuleTargetSchema = z.object({ visualModuleId: identifierSchema });
export const visualModuleTargetSchema = z.union([
	registeredVisualModuleTargetSchema,
	z.object({ sceneId: identifierSchema, inlineVisualModuleLayerId: identifierSchema }),
]).describe('A registered Visual Module or an inline Visual Module owned by a Timeline layer. Pass the target returned by Query or Command.');
export const visualModuleNodeReferenceSchema = z.object({ visualModule: visualModuleTargetSchema, nodeId: identifierSchema });
export const visualModuleNodeParameterReferenceSchema = z.object({ target: visualModuleNodeReferenceSchema, parameterPath: parameterPathSchema });
// branded IDはドメイン内部での取り違えを防ぐための型。外部との保存形式は文字列のまま。
export const visualModulePublicParameterIdSchema = z.string() as unknown as z.ZodType<VisualModulePublicParameterId>;
export const visualModuleCustomParameterIdSchema = z.string() as unknown as z.ZodType<VisualModuleCustomParameterId>;
const visualModulePublicParameterNameSchema = z.string() as unknown as z.ZodType<VisualModulePublicParameterName>;
const visualModuleCustomParameterNameSchema = z.string() as unknown as z.ZodType<VisualModuleCustomParameterName>;
export const visualModulePublicParameterReferenceSchema = z.object({ visualModule: visualModuleTargetSchema, parameterId: visualModulePublicParameterIdSchema });
export const visualModuleCustomParameterReferenceSchema = z.object({ visualModule: visualModuleTargetSchema, parameterId: visualModuleCustomParameterIdSchema });
export const visualModuleOutputReferenceSchema = z.object({ visualModule: visualModuleTargetSchema, outputId: identifierSchema });
export const connectionTypePolicySchema = z.enum(['strict', 'allowMismatch']).describe('strict rejects incompatible texture types. allowMismatch explicitly permits them; it does not convert the data.');
export const visualModuleNodeOutputReferenceSchema = z.object({ nodeId: z.string(), outputPort: z.string() });
const unconnectedOutputSchema = z.object({ nodeId: z.null(), outputPort: z.null() });
export const visualModuleNodeOutputConnectionSchema = z.union([visualModuleNodeOutputReferenceSchema, unconnectedOutputSchema]);
// UIの再接続もサンプリング設定を省略できる。型付きの保存表現に合わせて必須にすると
// 既存のCommand経路を拒否してしまうため、境界ではrendererが扱う省略形を受け入れる。
const nodeParameterBindingSchema = z.union([
	z.object({ inputSource: z.literal('node'), nodeId: z.string(), outputPort: z.string(), fitMode: fitModeSchema.optional(), wrapMode: wrapModeSchema.optional(), filterMode: z.enum(['linear', 'nearest']).optional() }),
	z.object({ inputSource: z.literal('node'), nodeId: z.null(), outputPort: z.null() }),
]) as z.ZodType<VisualModuleNodeParameterBinding>;
const publicParameterBindingSchema = z.object({ inputSource: z.literal('visualModulePublicParameterReference'), parameterId: visualModulePublicParameterIdSchema });
const customParameterBindingSchema = z.object({ inputSource: z.literal('visualModuleCustomParameterValueReference'), parameterId: visualModuleCustomParameterIdSchema });
export const visualModuleValueParameterBindingSchema: z.ZodType<VisualModuleValueParameterBinding> = z.union([valueParameterBindingSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const visualModuleParameterBindingSchema: z.ZodType<VisualModuleParameterBinding> = z.union([visualModuleValueParameterBindingSchema, nodeParameterBindingSchema])
	.describe('Binding stored on a Visual Module parameter. Literal shape and available sources depend on the parameter definition.');
export const visualModuleValueParameterSourceSchema = z.union([valueParameterSourceSchema, publicParameterBindingSchema, customParameterBindingSchema]);
export const visualModuleParameterSourceSchema = z.union([visualModuleValueParameterSourceSchema, nodeParameterBindingSchema]);
export const visualModuleParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'visualModulePublicParameterReference', 'visualModuleCustomParameterValueReference', 'node']);
export const visualModuleValueParameterInputSourceSchema = z.enum(['literal', 'envVariable', 'expression', 'automationGraphReference', 'automationGraphInline', 'keyframesTimelineInline', 'visualModulePublicParameterReference', 'visualModuleCustomParameterValueReference']);

export const visualModulePublicParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: visualModulePublicParameterNameSchema, canNode: z.boolean() })) as z.ZodType<Omit<VisualModuleParamDef, 'id'>>;
export const visualModulePublicParameterDefinitionSchema = z.intersection(visualModulePublicParameterInputSchema,
	z.object({ id: visualModulePublicParameterIdSchema })) as z.ZodType<VisualModuleParamDef>;
export const visualModuleCustomParameterInputSchema = z.intersection(parameterDefinitionSchema,
	z.object({ nameForReference: visualModuleCustomParameterNameSchema, canNode: z.literal(false), dataType: z.object({ kind: z.enum(['scalar', 'bool', 'string', 'color', 'vector', 'enum', 'colorRamp', 'sizeReference']) }) })) as z.ZodType<Omit<VisualModuleCustomParameterDefinition, 'id'>>;
export const visualModuleCustomParameterDefinitionSchema = z.intersection(visualModuleCustomParameterInputSchema,
	z.object({ id: visualModuleCustomParameterIdSchema })) as z.ZodType<VisualModuleCustomParameterDefinition>;
export const visualModuleOutputInputSchema = z.object({ label: z.string(), name: z.string(), dataType: textureDataTypeSchema });
export const visualModuleOutputDefinitionSchema = visualModuleOutputInputSchema.extend({ id: z.string() });
const positionSchema = z.object({ x: z.number(), y: z.number() });
export const visualModuleNodeSchema: z.ZodType<VisualModuleNode> = z.union([
	z.object({
		id: z.string(), type: z.literal('effect'), effectId: z.string(), isBypass: z.boolean(), resolution: effectResolutionSchema,
		params: z.record(z.string(), visualModuleParameterBindingSchema), staticSettings: staticSettingValuesSchema, displayName: z.string(), pos: positionSchema.optional(),
	}),
	z.object({ id: z.string(), type: z.literal('globalIn'), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('globalOut'), inputs: z.record(z.string(), visualModuleNodeOutputConnectionSchema), pos: positionSchema.optional() }),
	z.object({ id: z.string(), type: z.literal('relay'), label: z.string().optional(), dataType: textureDataTypeSchema, input: visualModuleNodeOutputConnectionSchema, pos: positionSchema.optional() }),
]);
export const visualModuleSchema: z.ZodType<VisualModule> = z.object({
	nodes: z.array(visualModuleNodeSchema), outputDefs: z.array(visualModuleOutputDefinitionSchema), primaryOutputId: z.string().nullable(),
	paramDefs: z.array(visualModulePublicParameterDefinitionSchema), customParameterDefs: z.array(visualModuleCustomParameterDefinitionSchema),
	customParameterValues: z.record(visualModuleCustomParameterIdSchema, visualModuleValueParameterBindingSchema),
	primaryInputId: visualModulePublicParameterIdSchema.nullable(), primaryAudioInputId: visualModulePublicParameterIdSchema.nullish(), automationGraphs: z.array(automationGraphSchema),
});
