import * as z from 'zod';
import { automationGraphDataSchema, parameterDefinitionSchema, textureDataTypeSchema } from './parameter-contract-schemas.ts';
import type { Player } from '@gs/shared/types.ts';
import type { ProjectCustomShaderEffect } from '@gs/glitch-studio_shared/project/types.ts';
import type { CustomShaderEffectParameterDefinition } from '@gs/subsystems_effect_shared/custom-shader-effect-definition.ts';
export { automationGraphSchema } from './parameter-contract-schemas.ts';

export const projectResolutionSchema = z.object({
	width: z.number().int({ error: 'Resolution width and height must be positive integers' }).positive({ error: 'Resolution width and height must be positive integers' }).describe('Render width in pixels. A positive safe integer.'),
	height: z.number().int({ error: 'Resolution width and height must be positive integers' }).positive({ error: 'Resolution width and height must be positive integers' }).describe('Render height in pixels. A positive safe integer.'),
});

export const timelineMotionBlurSettingsSchema = z.object({
	enabled: z.boolean(),
	shutterAngle: z.number().min(0).max(360).describe('Shutter angle in degrees.'),
	samples: z.number().int().min(0).max(128).describe('Motion blur sample count, from 0 to 128.'),
});

export const automationGraphDefinitionSchema = z.intersection(automationGraphDataSchema, z.object({ nameForReference: z.string() }));

export const playerSourceSchema = z.union([
	z.null(),
	z.object({ type: z.literal('asset'), assetId: z.string().min(1).describe('ID of an Asset already imported into the project.') }),
	z.object({ type: z.enum(['webcam', 'microphone', 'liveStream']) }),
]);

export const playerSchema: z.ZodType<Player> = z.object({
	id: z.string().min(1), name: z.string(),
	sourceType: z.enum(['asset', 'webcam', 'microphone', 'liveStream']).nullable(),
	assetId: z.string().nullable().optional(),
});

// 既存のEffectドメインの定義をAPI資料として表す。入力の対応関係や参照名の
// 重複など、定義同士を比較する検証はEffectドメインの検証関数が引き続き担当する。
const customShaderEffectParameterSchema = z.intersection(parameterDefinitionSchema, z.object({
	id: z.string().min(1), nameForReference: z.string(), canNode: z.literal(true), dataType: textureDataTypeSchema,
})) as z.ZodType<CustomShaderEffectParameterDefinition>;

export const projectCustomShaderEffectDefinitionSchema = z.object({
	name: z.string(), description: z.string(),
	shaderApiVersion: z.literal(1), codeLanguage: z.literal('wgsl'),
	code: z.string().describe('WGSL source. Incomplete source may be saved; compilation is checked by the renderer.'),
	kind: z.enum(['generate', 'modify']),
	paramDefs: z.array(customShaderEffectParameterSchema),
	outputDefs: z.array(z.object({ id: z.string().min(1), nameForReference: z.string(), label: z.string(), dataType: textureDataTypeSchema })),
	primaryInputId: z.string().nullable(), primaryOutputId: z.string().nullable(), resolutionInputIds: z.array(z.string()),
});

export const projectCustomShaderEffectSchema: z.ZodType<ProjectCustomShaderEffect> = projectCustomShaderEffectDefinitionSchema.extend({ id: z.string().min(1) });
