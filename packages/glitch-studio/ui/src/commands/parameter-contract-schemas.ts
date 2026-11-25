import { z } from 'zod';
import { EASING_FAMILIES, EASING_DIRECTIONS } from '@gs/shared/easing.ts';
import { SIZE_REFERENCES } from '@gs/shared/size-reference.ts';
import { COLOR_RAMP_INTERPOLATIONS } from '@gs/shared/color-ramp.ts';
import { colorBlendModes } from '@gs/shared/color-blend.ts';
import { isValidCurveAnimationYRange } from '@gs/shared/curve-animation/curve-animation.ts';
import { validateParameterDefaultValues } from '@gs/shared/parameter/static-parameter.ts';
import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { ValueParameterBinding, ValueParameterSource } from '@gs/shared/parameter/value-parameter-binding.ts';
import type { KeyframesTimelineData } from '@gs/shared/keyframes/keyframes-timeline.ts';
import type { ParamPath } from '@gs/shared/parameter/parameter-path.ts';

// Project APIの境界で使う保存形式の説明。対象の存在、型同士の対応、利用可能な入力方式は
// 各ドメインの検証に任せる。特にUIのmin/maxを数値そのものの制限に読み替えない。
export const connectionTypePolicySchema = z.enum(['strict', 'allowMismatch']).describe('strict rejects incompatible port data types. allowMismatch permits the connection without converting the data.');

export const identifierSchema = z.string().min(1).describe('Existing or newly returned identifier. Names and array indexes are not identifiers.');
export const parameterPathSchema: z.ZodType<ParamPath> = z.tuple([z.string()], z.string()).describe('Nonempty parameter path. Array entries are addressed by element IDs, not numeric indexes.');
export const vectorValueSchema = z.tuple([z.number(), z.number()]);
export const colorValueSchema = z.tuple([z.number(), z.number(), z.number(), z.number()])
	.describe('Linear sRGB RGBA. Negative and HDR RGB values are preserved.');
export const sizeReferenceSchema = z.enum(SIZE_REFERENCES);
export const fitModeSchema = z.enum(['stretch', 'cover', 'contain']);
export const wrapModeSchema = z.enum(['clamp', 'repeat', 'repeatMirrored', 'transparent']);
export const textureDataTypeSchema: z.ZodType<TextureDataType> = z.object({ kind: z.enum(['scalar', 'color', 'vector', 'any']) });
export const dataTypeSchema: z.ZodType<DataType> = z.lazy(() => z.union([
	z.object({ kind: z.enum(['scalar', 'bool', 'string', 'color', 'colorRamp', 'vector', 'blendMode', 'fitMode', 'sizeReference', 'wrapMode', 'audioSource', 'any']) }),
	z.object({ kind: z.literal('enum'), options: z.array(z.string()) }),
	z.object({ kind: z.literal('array'), elementType: dataTypeSchema }),
	z.object({ kind: z.literal('struct'), fields: z.record(z.string(), dataTypeSchema) }),
]));

export const parameterExpressionModifierSchema = z.object({ enabled: z.boolean(), code: z.string() })
	.describe('AiScript expression applied after the input value. null or omission means no modifier.');
const functionCurvePointSchema = z.object({
	id: z.string().min(1), x: z.number(), y: z.number(), bezierControlPointA: vectorValueSchema, bezierControlPointB: vectorValueSchema,
});
const bezierFunctionCurveSchema = z.object({
	type: z.literal('bezier'),
	points: z.array(functionCurvePointSchema).refine(points => new Set(points.map(point => point.id)).size === points.length, { message: 'Duplicate Function Curve point ID' }),
	isXNormalized: z.boolean().describe('X uses normalized coordinates when true.'),
	isYNormalized: z.boolean().describe('Y uses normalized coordinates when true. Values outside 0 to 1 are valid.'),
});
const fixedFunctionCurveSchemas = [
	z.object({ type: z.literal('linear') }),
	z.object({ type: z.literal('smoothstep') }),
	z.object({ type: z.literal('smootherstep') }),
	z.object({ type: z.literal('easing'), family: z.enum(EASING_FAMILIES), direction: z.enum(EASING_DIRECTIONS) }),
	z.object({ type: z.literal('smoothPulse') }),
	z.object({ type: z.literal('pulse'), dutyCycle: z.number().min(0).max(1).describe('Fraction of the interval spent at 1, centered at X = 0.5.') }),
	z.object({ type: z.literal('steps'), levelCount: z.number().int().min(2).describe('Number of equally wide levels, including 0 and 1.') }),
	z.object({ type: z.literal('sineWave') }),
	z.object({ type: z.literal('deadZone'), deadZoneWidth: z.number().min(0).max(1).describe('Width of the plateau at Y = 0.5, centered at X = 0.5.') }),
] as const;
export const functionCurveSchema = z.discriminatedUnion('type', [bezierFunctionCurveSchema, ...fixedFunctionCurveSchemas]);
export const newFunctionCurveSchema = z.discriminatedUnion('type', [
	bezierFunctionCurveSchema.extend({ points: z.array(functionCurvePointSchema.omit({ id: true })) }),
	...fixedFunctionCurveSchemas,
]);
export const sharedFunctionCurveSchema = z.intersection(functionCurveSchema, z.object({ id: z.string(), nameForReference: z.string() }));
export const parameterPlaybackShape = {
	trimmedDurationMs: z.number().nullable().describe('Duration in milliseconds for normalized data; null means 1000 ms.'),
	offsetMode: z.enum(['start', 'end']), wrapMode: z.enum(['clamp', 'repeat', 'repeatMirrored']),
};
export const keyframeInterpolationSchema = z.union([
	z.object({ type: z.enum(['hold', 'linear']) }),
	z.object({ type: z.enum(['ease:sine', 'ease:quad', 'ease:cubic', 'ease:quart', 'ease:quint', 'ease:expo', 'ease:circ', 'ease:back', 'ease:elastic', 'ease:bounce']), direction: z.enum(['in', 'out', 'inOut']) }),
]);

// dataTypeとvalueの対応は利用箇所の既存検証でも確認する。ここでは静的に表せる
// 各種類の構造を列挙し、資料だけを見てもキーの値と補間方式を構築できるようにする。
function keyframesOf<Kind extends 'scalar' | 'vector' | 'color' | 'string' | 'bool' | 'sizeReference'>(kind: Kind, value: z.ZodType, interpolated: boolean) {
	return z.object({
		dataType: z.object({ kind: z.literal(kind) }), isNormalized: z.boolean(),
		keyframes: z.array(z.object({ id: z.string(), x: z.number(), value, interpolation: interpolated ? keyframeInterpolationSchema : z.object({ type: z.literal('hold') }) })),
	});
}

export const keyframesTimelineDataSchema = z.union([
	keyframesOf('scalar', z.number(), true), keyframesOf('vector', vectorValueSchema, true), keyframesOf('color', colorValueSchema, true),
	keyframesOf('string', z.string(), false), keyframesOf('bool', z.boolean(), false), keyframesOf('sizeReference', sizeReferenceSchema, false),
	z.object({
		dataType: z.object({ kind: z.literal('enum'), options: z.array(z.string()) }),
		isNormalized: z.boolean(),
		keyframes: z.array(z.object({ id: z.string(), x: z.number(), value: z.string(), interpolation: z.object({ type: z.literal('hold') }) })),
	}),
]) as z.ZodType<KeyframesTimelineData>;

export const colorRampSchema = z.object({
	stops: z.array(z.object({ id: z.string(), position: z.number(), color: colorValueSchema })),
	interpolation: z.enum(COLOR_RAMP_INTERPOLATIONS), colorSpace: z.enum(['srgb', 'linearSrgb', 'oklab', 'oklch']),
	repeatCount: z.number(), repeatMode: z.enum(['wrap', 'pingPong']), hueInterpolation: z.enum(['shorter', 'longer', 'increasing', 'decreasing']).optional(),
});

// literalは対象パラメータから型を解決する。配列・構造体の場合は子のBindingを含み、
// 音声入力は利用ドメイン固有の参照を含むため、JSON値を境界の契約とする。
export const literalParameterValueSchema = z.json().describe('Literal value matching the parameter dataType. Containers contain child bindings; obtain the parameter definition before constructing this value.');
const expressionModifierShape = { expressionModifier: parameterExpressionModifierSchema.nullish() };
export const literalParameterBindingSchema = z.object({ inputSource: z.literal('literal'), value: literalParameterValueSchema, ...expressionModifierShape });
export const curveAnimationSchema = z.object({
	curveBinding: z.discriminatedUnion('source', [
		z.object({ source: z.literal('inline'), curve: functionCurveSchema }),
		z.object({ source: z.literal('reference'), curveId: z.string().min(1).nullable() }),
	]),
	...parameterPlaybackShape,
	yRangeMin: z.number().nullable().describe('Output at normalized Y = 0. Null means 0.'),
	yRangeMax: z.number().nullable().describe('Output at normalized Y = 1. Null means 1.'),
}).refine(isValidCurveAnimationYRange, { message: 'Curve Animation Y range must be finite and ordered' });

export const keyframesParameterBindingSchema = z.object({ inputSource: z.literal('keyframesTimelineInline'), keyframesTimeline: keyframesTimelineDataSchema, ...parameterPlaybackShape, ...expressionModifierShape });
export const valueParameterSourceSchema: z.ZodType<ValueParameterSource> = z.union([
	z.object({ inputSource: z.literal('literal'), value: literalParameterValueSchema }),
	z.object({ inputSource: z.literal('envVariable'), variable: z.string() }),
	z.object({ inputSource: z.literal('expression'), expression: z.string() }),
	z.object({ inputSource: z.literal('curveAnimationInline'), curveAnimation: curveAnimationSchema }),
	z.object({ inputSource: z.literal('keyframesTimelineInline'), keyframesTimeline: keyframesTimelineDataSchema, ...parameterPlaybackShape }),
]);
export const valueParameterBindingSchema: z.ZodType<ValueParameterBinding> = z.intersection(valueParameterSourceSchema, z.object(expressionModifierShape));
export const structParameterFieldBindingsSchema = z.record(z.string(), z.union([literalParameterBindingSchema, keyframesParameterBindingSchema]));

const emptyControlSchema = z.strictObject({});
const scalarControlSchema = z.union([
	z.object({ controlType: z.literal('number'), min: z.number().optional(), max: z.number().optional(), step: z.number().optional() }),
	z.object({ controlType: z.literal('range'), min: z.number(), max: z.number(), step: z.number().optional(), logarithmic: z.boolean().optional() }),
	z.object({ controlType: z.literal('angle'), step: z.number().optional() }),
	z.object({ controlType: z.literal('seed') }),
]);
const vectorControlSchema = z.object({ controlType: z.enum(['vector', 'xy', 'dimension']), min: z.number().optional(), max: z.number().optional(), step: z.number().optional(), logarithmic: z.boolean().optional() });
const parameterDefaultSchema = z.json().describe('Value matching the dataType. Use plain array elements and struct field values. Audio source defaults are null.');
type ParameterSettingsData = { defaultValue: z.infer<typeof parameterDefaultSchema>; canNode?: boolean; maxElements?: number; element?: ParameterSettingsData; fields?: Record<string, ParameterSettingsData> };
const parameterSettingsSchema: z.ZodType<ParameterSettingsData> = z.lazy(() => z.object({
	defaultValue: parameterDefaultSchema, canNode: z.boolean().optional(), maxElements: z.number().optional(),
	element: parameterSettingsSchema.optional(), fields: z.record(z.string(), parameterSettingsSchema).optional(),
}));
type ParameterControlData = Record<string, unknown>;
const parameterControlSchema: z.ZodType<ParameterControlData> = z.lazy(() => z.union([
	// 任意フィールドだけの色UIがコンテナまで受理すると、fieldsや初期展開指定が消えてしまう。
	scalarControlSchema, vectorControlSchema, z.strictObject({ controlType: z.enum(['color', 'signal']).optional() }),
	z.object({ labels: z.record(z.string(), z.string()) }),
	z.object({ element: parameterControlSchema, defaultExpanded: z.boolean().optional() }),
	z.object({
		fields: z.record(z.string(), z.object({ label: z.string(), isAdvanced: z.boolean().optional(), control: parameterControlSchema })),
		controlType: z.enum(['struct', 'viewport2d']).optional(),
		defaultExpanded: z.boolean().optional(),
		spanAtZoomOne: z.number().optional(), minimumZoom: z.number().optional(), maximumZoom: z.number().optional(),
	}),
	emptyControlSchema,
]));

function leafParameterDefinition(kind: string, control: z.ZodType, value: z.ZodType, canNode: z.ZodType = z.literal(false).optional()) {
	return z.object({
		dataType: z.object({ kind: z.literal(kind) }),
		ui: z.object({ label: z.string(), isAdvanced: z.boolean().optional(), control }),
		defaultValue: value, canNode,
	});
}

export const parameterDefinitionSchema = z.union([
	leafParameterDefinition('scalar', scalarControlSchema, z.number(), z.boolean().optional()),
	leafParameterDefinition('bool', emptyControlSchema, z.boolean()), leafParameterDefinition('string', emptyControlSchema, z.string()),
	leafParameterDefinition('color', z.object({ controlType: z.enum(['color', 'signal']).optional() }), colorValueSchema, z.boolean().optional()),
	leafParameterDefinition('colorRamp', emptyControlSchema, colorRampSchema),
	leafParameterDefinition('vector', vectorControlSchema, vectorValueSchema, z.boolean().optional()),
	leafParameterDefinition('blendMode', emptyControlSchema, z.enum(Object.keys(colorBlendModes) as [keyof typeof colorBlendModes, ...(keyof typeof colorBlendModes)[]])),
	leafParameterDefinition('fitMode', emptyControlSchema, fitModeSchema), leafParameterDefinition('wrapMode', emptyControlSchema, wrapModeSchema),
	leafParameterDefinition('sizeReference', emptyControlSchema, sizeReferenceSchema), leafParameterDefinition('audioSource', emptyControlSchema, z.null()),
	leafParameterDefinition('any', emptyControlSchema, colorValueSchema.nullable(), z.literal(true)),
	z.object({
		dataType: z.object({ kind: z.literal('enum'), options: z.array(z.string()) }),
		ui: z.object({ label: z.string(), isAdvanced: z.boolean().optional(), control: z.object({ labels: z.record(z.string(), z.string()) }) }),
		defaultValue: z.string(), canNode: z.literal(false).optional(),
	}),
	z.object({
		dataType: z.object({ kind: z.literal('array'), elementType: dataTypeSchema }),
		ui: z.object({ label: z.string(), isAdvanced: z.boolean().optional(), control: z.object({ element: parameterControlSchema, defaultExpanded: z.boolean().optional() }) }),
		defaultValue: z.array(parameterDefaultSchema), canNode: z.literal(false).optional(), maxElements: z.number().optional(), element: parameterSettingsSchema,
	}),
	z.object({
		dataType: z.object({ kind: z.literal('struct'), fields: z.record(z.string(), dataTypeSchema) }),
		ui: z.object({ label: z.string(), isAdvanced: z.boolean().optional(), control: parameterControlSchema }),
		defaultValue: z.record(z.string(), parameterDefaultSchema), canNode: z.literal(false).optional(), fields: z.record(z.string(), parameterSettingsSchema),
	}),
]).superRefine((definition, context) => {
	if (definition.dataType.kind !== 'array' && definition.dataType.kind !== 'struct') return;
	try {
		validateParameterDefaultValues(definition as ParameterDefinition);
	} catch (error) {
		context.addIssue({ code: 'custom', path: ['defaultValue'], message: error instanceof Error ? error.message : String(error) });
	}
}) as z.ZodType<ParameterDefinition>;

export const staticSettingValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const staticSettingValuesSchema = z.record(z.string(), staticSettingValueSchema);
export const staticSettingDefinitionSchema = z.union([
	z.object({ dataType: z.object({ kind: z.literal('assetReference'), assetType: z.enum(['image', 'video', 'font', 'lut']) }), ui: z.object({ label: z.string() }), defaultValue: z.string().nullable() }),
	z.object({ dataType: z.object({ kind: z.literal('scalar') }), ui: z.object({ label: z.string() }), defaultValue: z.number() }),
	z.object({ dataType: z.object({ kind: z.literal('bool') }), ui: z.object({ label: z.string() }), defaultValue: z.boolean() }),
	z.object({ dataType: z.object({ kind: z.literal('string') }), ui: z.object({ label: z.string() }), defaultValue: z.string() }),
	z.object({ dataType: z.object({ kind: z.literal('enum'), options: z.array(z.string()).readonly() }), ui: z.object({ label: z.string() }), defaultValue: z.string() }),
]);
export const effectResolutionSchema = z.union([
	z.object({ mode: z.enum(['auto', 'context']), scale: z.number().positive() }),
	z.object({ mode: z.literal('customAbsolute'), width: z.number().int().positive(), height: z.number().int().positive() }),
]);
