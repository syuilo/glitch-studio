import { effectSourceSchema, samplingSchema } from './effect-source-schema.ts';
import * as z from 'zod';
import { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
import { timelineCameraParamDefs } from '@gs/subsystems_timeline_shared/layers/camera/camera.ts';
import { timelineTransformParamDefs } from '@gs/subsystems_timeline_shared/layers/transform/transform.ts';
import { shapeDefinitions } from '@gs/subsystems_timeline_shared/layers/shape/shape.ts';
import { textParamDefs } from '@gs/subsystems_timeline_shared/layers/text/text.ts';
import { voicevoxSubtitleParamDefs } from '@gs/subsystems_timeline_shared/layers/voicevox/voicevox-subtitle.ts';
import {
	sharedFunctionCurveSchema, effectResolutionSchema, keyframeInterpolationSchema, parameterDefinitionSchema,
	parameterPathSchema, staticSettingValuesSchema, valueParameterBindingSchema,
} from './parameter-contract-schemas.ts';
import type { TimelineLayer } from '@gs/subsystems_timeline_shared/types.ts';
import type { TimelineLayerPublicParameterDefinition, TimelineLayerPublicParameterId } from '@gs/subsystems_timeline_shared/public-parameters.ts';
import type { TimelineParameterBinding } from '@gs/subsystems_timeline_shared/parameter-binding.ts';
import type { KeyframesDataType } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { EditableTimelineParameterBinding } from '../types/parameter-edit.ts';

const identifier = z.string().min(1);
export const timelineSceneReferenceSchema = z.looseObject({ sceneId: identifier.describe('Timeline Scene ID.') });
export const timelineLayerReferenceSchema = timelineSceneReferenceSchema.extend({ layerId: identifier.describe('Layer ID within the Scene.') });
export const timelineClipReferenceSchema = timelineLayerReferenceSchema.extend({ clipId: identifier.describe('Clip ID within the Layer.') });
export const timelineClipTargetSchema = z.looseObject({ layerId: identifier, clipId: identifier });
export const timelineParameterGroupSchema = z.enum(['publicParameter', 'effect', 'shape', 'text', 'voicevoxSubtitle', 'camera', 'transform', 'compositing', 'audio']);
export const timelineParameterReferenceSchema = timelineLayerReferenceSchema.extend({
	parameterGroup: timelineParameterGroupSchema,
	parameterPath: parameterPathSchema.describe('Parameter keys and stable array element IDs; array indexes are not accepted.'),
});
// ブランドはドメイン内の取り違え防止だけに使い、通信上のIDは通常の文字列で表す。
export const timelineLayerPublicParameterIdSchema = identifier as unknown as z.ZodType<TimelineLayerPublicParameterId>;
export const timelinePublicParameterReferenceSchema = timelineLayerReferenceSchema.extend({ parameterId: timelineLayerPublicParameterIdSchema });
export const timelineSceneResolutionSchema = z.union([
	z.looseObject({ mode: z.literal('project') }),
	z.looseObject({ mode: z.literal('customAbsolute'), width: z.number().int().positive(), height: z.number().int().positive() }),
]).describe('project uses the Project resolution, including in nested Scenes. customAbsolute uses pixel dimensions.');
export const timelineContainerTypeSchema = z.enum(['folder', 'parameterContainer', 'transform', 'group']);
export const timelineMaskSchema = z.looseObject({ channel: z.enum(['alpha', 'luminance']), inverted: z.boolean() });
export const timelineLayerMaskSchema = timelineMaskSchema.extend({ sourceLayerId: identifier });

const placementShape = {
	startMs: z.number().int().nonnegative().describe('Placement start in the owning Scene, in integer milliseconds.'),
	durationMs: z.number().int().positive().describe('Placement duration in integer milliseconds.'),
};
const contentTimingSchema = z.looseObject({ ...placementShape, contentOffsetMs: z.number().describe('Content offset in milliseconds; fractional milliseconds are retained.') });
const mediaTimingSchema = z.looseObject({
	...placementShape,
	sourceInMs: z.number().nonnegative(), sourceOutMs: z.number().nonnegative(),
	playbackRate: z.number().describe('Signed playback multiplier; negative values reverse playback. Absolute value must be 0.01–16.'),
	loop: z.boolean(),
});
const holdTimingSchema = z.looseObject({ ...placementShape, sourceTimeMs: z.number().nonnegative().describe('The fixed source frame time in milliseconds.') });
export const timelineClipTimingSchema = z.union([mediaTimingSchema, holdTimingSchema, contentTimingSchema]);
const clipSourceShape = { assetId: identifier.optional(), sceneId: identifier.optional(), audioEnabled: z.boolean().optional(), videoEnabled: z.boolean().optional() };
// 取得済みClipを再利用できるよう、所在などの追加フィールドは保持する。
// 時間モデル・Layer種別・素材長の組み合わせは既存のTimeline検証で確認する。
export const timelineClipRecipeSchema = z.union([
	mediaTimingSchema.extend(clipSourceShape), holdTimingSchema.extend(clipSourceShape), contentTimingSchema.extend(clipSourceShape),
]);
export const timelineClipSchema = z.union([
	mediaTimingSchema.extend({ id: identifier, ...clipSourceShape }),
	holdTimingSchema.extend({ id: identifier, ...clipSourceShape }),
	contentTimingSchema.extend({ id: identifier, ...clipSourceShape }),
]);
const contentClipSchema = contentTimingSchema.extend({ id: identifier });
const assetClipSchema = contentClipSchema.extend({ assetId: identifier });
const sceneClipSchema = contentClipSchema.extend({ sceneId: identifier });
const mediaClipSchema = mediaTimingSchema.extend({ id: identifier, assetId: identifier });
const videoClipSchema = z.union([
	mediaClipSchema.extend({ audioEnabled: z.boolean(), videoEnabled: z.boolean() }),
	holdTimingSchema.extend({ id: identifier, assetId: identifier, audioEnabled: z.literal(false), videoEnabled: z.literal(true) }),
]);
export const timelineLayerRecipeSchema = z.union([
	z.looseObject({ name: z.string().nullish(), layerType: z.literal('effect'), effectSource: effectSourceSchema }),
	z.looseObject({ name: z.string().nullish(), layerType: z.literal('shape'), shapeType: z.enum(['ellipse', 'rectangle']) }),

	z.looseObject({ name: z.string().nullish(), layerType: z.enum(['text', 'camera', 'voicevox', 'image', 'video', 'audio', 'scene', 'folder', 'parameterContainer', 'transform', 'group']) }),
]);

export const voicevoxSettingsSchema = z.looseObject({ speedScale: z.number().min(0.5).max(2) });
export const voicevoxUtteranceSchema = z.looseObject({
	id: identifier, timeMs: z.number().int().nonnegative(), text: z.string(), reading: z.string().nullable(),
	styleId: z.number().int().nonnegative(),
	subtitleDuration: z.union([
		z.looseObject({ mode: z.literal('fill') }),
		z.looseObject({ mode: z.literal('specified'), durationMs: z.number().int().nonnegative() }),
		z.looseObject({ mode: z.literal('speech'), extensionMs: z.number().int().nonnegative() }),
	]),
});

const publicParameterBindingSchema = z.looseObject({ inputSource: z.literal('timelineLayerPublicParameterReference'), layerId: identifier.nullable(), parameterId: timelineLayerPublicParameterIdSchema.nullable() });
export const timelineParameterBindingSchema: z.ZodType<TimelineParameterBinding> = z.union([valueParameterBindingSchema, publicParameterBindingSchema]);
export const timelineEditableParameterBindingSchema = z.union([
	timelineParameterBindingSchema,
	z.looseObject({ inputSource: z.literal('lowerLayerOutput'), sampling: samplingSchema.optional() }),
	z.looseObject({ inputSource: z.literal('anotherLayerOutput'), layerId: identifier.nullable(), outputStage: z.enum(['source', 'rendered', 'composited']), sampling: samplingSchema.optional() }),
	z.looseObject({ inputSource: z.literal('lowerLayerAudio') }),
	z.looseObject({ inputSource: z.literal('anotherLayerAudio'), layerId: identifier.nullable() }),
]) satisfies z.ZodType<EditableTimelineParameterBinding>;

// ParameterDefinitionの構造を共有し、Timelineが公開できる型・参照名の条件は
// 所有ドメインのvalidateTimelineLayerPublicParameterDefinitionsに残す。
export const timelineLayerPublicParameterDefinitionSchema = z.intersection(parameterDefinitionSchema,
	z.looseObject({ id: timelineLayerPublicParameterIdSchema, nameForReference: identifier })) as z.ZodType<TimelineLayerPublicParameterDefinition>;
export const timelineLayerPublicParameterRecipeSchema = z.intersection(parameterDefinitionSchema,
	z.looseObject({ nameForReference: identifier }));

function parameterValues<Definitions extends Record<string, unknown>>(definitions: Definitions) {
	// キーを各Layerが所有する定義から得る。Transform操作は未設定へ戻すために
	// キーを削除するので、保存された値の省略は各定義の既定値を使うことを表す。
	const shape = Object.fromEntries(Object.keys(definitions).map(key => [key, timelineParameterBindingSchema])) as { [Key in keyof Definitions]: typeof timelineParameterBindingSchema };
	return z.looseObject(shape).partial();
}

const layerCommon = { id: identifier, name: z.string(), color: z.tuple([z.number(), z.number(), z.number(), z.number()]).nullable(), isDisabled: z.boolean(), isSolo: z.boolean() };
const layerParameters = {
	functionCurves: z.array(sharedFunctionCurveSchema),
	publicParameterDefs: z.array(timelineLayerPublicParameterDefinitionSchema).optional(),
	publicParameterValues: z.record(z.string(), timelineParameterBindingSchema).optional(),
};
const visualLayer = {
	coordinateSpace: z.enum(['world', 'screen']), mask: timelineMaskSchema.nullable(), layerMask: timelineLayerMaskSchema.nullable(),
	isIncludedInComposite: z.boolean(), forceDisableMotionBlur: z.boolean(),
	compositingParamValues: parameterValues(timelineCompositingParamDefs),
};
const audioLayer = { audioParamValues: z.looseObject({ volume: timelineParameterBindingSchema }) };
const clipLayer = { ...layerCommon, ...layerParameters, clips: z.array(contentClipSchema) };
const fontSettings = z.looseObject({ font: z.string().nullable() });
const shapeSchema = z.discriminatedUnion('type', [
	z.looseObject({ type: z.literal('ellipse'), paramValues: parameterValues(shapeDefinitions.ellipse.paramDefs) }),
	z.looseObject({ type: z.literal('rectangle'), paramValues: parameterValues(shapeDefinitions.rectangle.paramDefs) }),
]);

// 再帰は子Layerだけを辿る。別Scene参照はIDのままとし、参照循環を展開しない。
export const timelineLayerSchema: z.ZodType<TimelineLayer> = z.lazy(() => z.discriminatedUnion('layerType', [
	z.looseObject({ ...clipLayer, ...visualLayer, layerType: z.literal('effect'), transformTarget: z.enum(['image', 'region']).optional(), effectSource: effectSourceSchema, effectParamValues: z.record(z.string(), timelineEditableParameterBindingSchema), effectStaticSettings: staticSettingValuesSchema, resolution: effectResolutionSchema }),
	z.looseObject({ ...clipLayer, ...visualLayer, layerType: z.literal('shape'), shape: shapeSchema }),
	z.looseObject({ ...clipLayer, ...visualLayer, layerType: z.literal('text'), textParamValues: parameterValues(textParamDefs), textStaticSettings: fontSettings }),
	z.looseObject({ ...clipLayer, ...visualLayer, layerType: z.literal('image'), clips: z.array(assetClipSchema) }),
	z.looseObject({ ...clipLayer, ...visualLayer, ...audioLayer, layerType: z.literal('video'), clips: z.array(videoClipSchema) }),
	z.looseObject({ ...clipLayer, ...visualLayer, ...audioLayer, layerType: z.literal('scene'), clips: z.array(sceneClipSchema) }),
	z.looseObject({ ...clipLayer, ...audioLayer, layerType: z.literal('audio'), clips: z.array(mediaClipSchema) }),
	z.looseObject({ ...clipLayer, layerType: z.literal('camera'), cameraParamValues: parameterValues(timelineCameraParamDefs), forceDisableMotionBlur: z.boolean() }),
	z.looseObject({ ...clipLayer, ...visualLayer, ...audioLayer, layerType: z.literal('voicevox'), voicevox: voicevoxSettingsSchema, utterances: z.array(voicevoxUtteranceSchema), subtitleParamValues: parameterValues(voicevoxSubtitleParamDefs), subtitleStaticSettings: fontSettings }),
	z.looseObject({ ...layerCommon, ...layerParameters, ...visualLayer, ...audioLayer, layerType: z.literal('group'), compositingMode: z.enum(['flat', 'preserveDepth']).optional(), layers: z.array(timelineLayerSchema) }),
	z.looseObject({ ...layerCommon, ...layerParameters, layerType: z.literal('transform'), transformParamValues: parameterValues(timelineTransformParamDefs), forceDisableMotionBlur: z.boolean(), layers: z.array(timelineLayerSchema) }),
	z.looseObject({ ...layerCommon, ...layerParameters, layerType: z.literal('parameterContainer'), layers: z.array(timelineLayerSchema) }),
	z.looseObject({ ...layerCommon, layerType: z.literal('folder'), layers: z.array(timelineLayerSchema) }),
])) as z.ZodType<TimelineLayer>;

export const timelineKeyframeTargetSchema = timelineParameterGroupSchema;
export const timelineKeyframeSelectionSchema = z.looseObject({ layerId: identifier, target: z.union([timelineKeyframeTargetSchema, z.literal('utterance')]), paramPath: parameterPathSchema, keyframeId: identifier });
export const timelineKeyframePositionSchema = timelineKeyframeSelectionSchema.extend({ x: z.number().int().nonnegative().describe('Absolute Scene time in integer milliseconds.') });
const keyframeValueSchema = z.union([z.number(), z.boolean(), z.string(), z.tuple([z.number(), z.number()]), z.tuple([z.number(), z.number(), z.number(), z.number()])]);
const keyframeDataTypeSchema: z.ZodType<KeyframesDataType, KeyframesDataType> = z.union([
	z.looseObject({ kind: z.enum(['scalar', 'vector', 'color', 'string', 'bool', 'sizeReference']) }),
	z.looseObject({ kind: z.literal('enum'), options: z.array(z.string()) }),
]);
export const timelineKeyframePasteSchema = z.union([
	z.looseObject({
		layerId: identifier, target: timelineKeyframeTargetSchema, paramPath: parameterPathSchema,
		dataType: keyframeDataTypeSchema,
		keyframe: z.looseObject({ id: identifier, x: z.number().int().nonnegative(), value: keyframeValueSchema, interpolation: keyframeInterpolationSchema }),
	}),
	z.looseObject({ layerId: identifier, target: z.literal('utterance'), paramPath: parameterPathSchema, utterance: voicevoxUtteranceSchema }),
]);
