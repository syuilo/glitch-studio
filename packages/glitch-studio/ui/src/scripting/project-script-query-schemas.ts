import { effectSourceSchema } from '../commands/effect-source-schema.ts';
import * as z from 'zod';
import { parameterDefinitionSchema, textureDataTypeSchema, staticSettingDefinitionSchema } from '../commands/parameter-contract-schemas.ts';
import { customNodeGraphEffectTargetSchema, customNodeGraphEffectNodeReferenceSchema, customNodeGraphEffectNodeSchema, customNodeGraphEffectSchema } from '../commands/custom-node-graph-effect-contract-schemas.ts';
import { timelineLayerSchema, timelineClipSchema, timelineSceneResolutionSchema, timelineSceneReferenceSchema, timelineLayerReferenceSchema, timelineClipReferenceSchema, timelineEditableParameterBindingSchema } from '../commands/timeline-contract-schemas.ts';
import { playerSchema, automationGraphSchema, projectCustomShaderEffectSchema, projectResolutionSchema, timelineMotionBlurSettingsSchema } from '../commands/project-contract-schemas.ts';

const identifierSchema = z.string().min(1).describe('An existing identifier returned by a Query or creation Command.');
export const assetReferenceSchema = z.looseObject({ assetId: identifierSchema });
export const playerReferenceSchema = z.looseObject({ playerId: identifierSchema });
export const effectReferenceSchema = z.looseObject({ effectSource: effectSourceSchema });
export const projectAutomationGraphReferenceSchema = z.looseObject({ automationGraphId: identifierSchema });
export const customShaderEffectReferenceSchema = z.looseObject({ customShaderEffectId: identifierSchema });

const exportScaleSchema = z.union([z.literal(0.25), z.literal(0.5), z.literal(1), z.literal(2), z.literal(4), z.literal('custom')]);
const exportQualitySchema = z.enum(['low', 'medium', 'high', 'very-high']);
const exportDialogSettingsSchema = z.looseObject({
	sceneId: z.string(),
	mode: z.enum(['video', 'still']),
	videoFormat: z.literal('mp4'),
	stillFormat: z.enum(['webp', 'exr']),
	videoQuality: exportQualitySchema,
	stillQuality: z.union([exportQualitySchema, z.literal('lossless')]),
	openExrCompression: z.enum(['none', 'zip']),
	resolutionScale: exportScaleSchema,
	// ダイアログは閉じると未確定・範囲外の入力も保存する。描画用のProject解像度と
	// 同じ制約を使うと、作品自体は正常でも概要を取得できなくなるため構造だけを表す。
	customResolution: z.looseObject({ width: z.number(), height: z.number() }).describe('Saved export dialog pixel dimensions. May still need validation before export.'),
	effectRenderTiling: z.discriminatedUnion('mode', [
		z.looseObject({ mode: z.literal('auto') }),
		z.looseObject({ mode: z.literal('disabled') }),
		z.looseObject({ mode: z.literal('manual'), tileSize: z.number() }),
	]),
	fpsScale: exportScaleSchema,
	customFps: z.number(),
	startTime: z.string().describe('Saved export dialog time text, normally HH:MM:SS.mmm. May contain unfinished input.'),
	endTime: z.string().describe('Saved export dialog time text, normally HH:MM:SS.mmm. May contain unfinished input.'),
});

export const projectSummarySchema = z.looseObject({
	name: z.string(),
	description: z.string(),
	author: z.string(),
	resolution: projectResolutionSchema,
	timelineFps: z.number().describe('Timeline frames per second.'),
	timelineMotionBlur: timelineMotionBlurSettingsSchema,
	exportSettings: exportDialogSettingsSchema.nullable(),
});

export const customNodeGraphEffectSummarySchema = z.looseObject({ target: customNodeGraphEffectTargetSchema, name: z.string() });
export const customNodeGraphEffectResultSchema = z.intersection(customNodeGraphEffectSchema, customNodeGraphEffectSummarySchema.extend({
	id: identifierSchema.optional().describe('Present on registered Custom Node Graph Effects. Inline Custom Node Graph Effects are identified by target instead.'),
}));
export const customNodeGraphEffectNodeSummarySchema = z.looseObject({
	target: customNodeGraphEffectNodeReferenceSchema,
	id: identifierSchema,
	type: z.enum(['effect', 'globalIn', 'globalOut', 'relay']),
	effectSource: effectSourceSchema.nullable(),
	displayName: z.string(),
});
export const customNodeGraphEffectNodeResultSchema = z.intersection(customNodeGraphEffectNodeSchema, z.looseObject({ target: customNodeGraphEffectNodeReferenceSchema }));

export const timelineSceneSummarySchema = z.looseObject({ target: timelineSceneReferenceSchema, name: z.string(), resolution: timelineSceneResolutionSchema });
export const timelineSceneResultSchema = timelineSceneSummarySchema.extend({ id: identifierSchema, layers: z.array(timelineLayerSchema) });
export const timelineLayerSummarySchema = z.looseObject({
	target: timelineLayerReferenceSchema,
	parentLayerId: z.string().nullable().describe('Parent layer ID, or null for a Scene root layer.'),
	name: z.string(),
	layerType: z.enum(['customNodeGraphEffect', 'inlineCustomNodeGraphEffect', 'effect', 'shape', 'text', 'audio', 'camera', 'voicevox', 'image', 'video', 'scene', 'group', 'transform', 'folder', 'parameterContainer']),
	isDisabled: z.boolean(),
	isSolo: z.boolean(),
});
export const timelineLayerResultSchema = z.intersection(timelineLayerSchema, z.looseObject({ target: timelineLayerReferenceSchema }));
export const timelineClipResultSchema = z.intersection(timelineClipSchema, z.looseObject({ target: timelineClipReferenceSchema }));
export const timelineLayerParametersSchema = z.record(z.string(), z.looseObject({
	definitions: z.record(z.string(), parameterDefinitionSchema),
	values: z.record(z.string(), timelineEditableParameterBindingSchema),
})).describe('Available parameter groups keyed by publicParameter, customNodeGraphEffect, effect, shape, text, voicevoxSubtitle, camera, transform, compositing or audio. Values are stored bindings, not evaluated values.');

export const assetMetadataSchema = z.looseObject({
	target: assetReferenceSchema,
	id: identifierSchema,
	name: z.string(),
	width: z.number(),
	height: z.number(),
	fileDataType: z.string().describe('Asset MIME type.'),
	hash: z.string().nullable(),
	isExternalReference: z.boolean(),
	sourceFilePath: z.string().nullable().describe('Stored external source path, or null. Asset bytes and thumbnails are not included.'),
});
export const playerResultSchema = z.intersection(playerSchema, z.looseObject({ target: playerReferenceSchema }));

export const effectSummarySchema = z.looseObject({
	target: effectReferenceSchema,
	effectSource: effectSourceSchema,
	displayName: z.string(),
	summary: z.looseObject({ 'ja-JP': z.string(), 'en-US': z.string() }),
	kind: z.enum(['generate', 'modify']),
	tags: z.array(z.string()).readonly(),
});
export const effectDefinitionResultSchema = effectSummarySchema.extend({
	dependsOnRenderHistory: z.boolean().optional(),
	canHaveLongRunningRenderPass: z.boolean().optional(),
	paramDefs: z.record(z.string(), parameterDefinitionSchema),
	staticSettingDefs: z.record(z.string(), staticSettingDefinitionSchema).optional(),
	intrinsicResolutionSetting: z.string().optional(),
	primaryInputParameter: z.string().nullable(),
	primaryAudioInputParameter: z.string().nullish(),
	// Effect定義はreadonly配列を公開する。検証が作った配列だけがreadonlyとなり、
	// 呼び出し元にはQueryが先に切り離した変更可能なデータを返す。
	resolutionInputParameters: z.array(z.string()).readonly(),
	outputDefs: z.record(z.string(), z.looseObject({ dataType: textureDataTypeSchema, label: z.string().optional(), canLazyAllocation: z.boolean().optional() })),
	primaryOutput: z.string().nullable(),
});

export const projectAutomationGraphResultSchema = z.intersection(automationGraphSchema, z.looseObject({ target: projectAutomationGraphReferenceSchema }));
export const customShaderEffectSummarySchema = z.looseObject({ target: customShaderEffectReferenceSchema, name: z.string(), summary: z.string() });
export const customShaderEffectResultSchema = z.intersection(projectCustomShaderEffectSchema, customShaderEffectSummarySchema);
