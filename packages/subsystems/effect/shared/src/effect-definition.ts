import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CheckedStaticSettingDefinition, StaticSettingDefinitions } from '@gs/shared/static-setting.ts';
import type { CheckedEffectParameterLayout, EffectParameterLayoutItem } from './effect-parameter-layout.ts';

/** Recordのキーは配線・保存用の固定ID。表示名や実装内で参照する名前から独立させる。 */
export interface EffectDefinition {
	readonly paramDefs: Readonly<Record<string, ParameterDefinition>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; label?: string }>>;
	readonly primaryInputParameter: string | null;
	readonly primaryOutput: string | null;
	readonly primaryAudioInputParameter?: string | null;
	readonly resolutionInputParameters: readonly string[];
	readonly staticSettingDefs?: StaticSettingDefinitions;
	readonly intrinsicResolutionSetting?: string;
	readonly ui?: { readonly parameterLayout: readonly EffectParameterLayoutItem[] };
	readonly kind: 'generate' | 'modify';
}

/** Native Effectの検索・表示と、履歴を持つ配置の識別に使うカタログ情報。 */
export interface NativeEffectDefinition extends EffectDefinition {
	/** ポートの画素を求める入力。省略時は全入力。寸法だけの依存はresolutionInputParametersで指定する。 */
	readonly outputDefs: Readonly<Record<string, EffectDefinition['outputDefs'][string] & { readonly inputParameters?: readonly string[] }>>;
	readonly displayName: string;
	readonly summary: Readonly<Record<'ja-JP' | 'en-US', string>>;
	readonly tags: readonly string[];
	readonly dependsOnRenderHistory: boolean;
	readonly canHaveLongRunningRenderPass?: boolean;
}

type ParameterId<D extends NativeEffectDefinition> = Extract<keyof D['paramDefs'], string>;
type MatchingKeys<T, Shape> = Extract<{ [K in keyof T]: T[K] extends Shape ? K : never }[keyof T], string>;
type HasTextureInput<T> = T extends { canNode: true } ? true
	: T extends { element: infer Element } ? HasTextureInput<Element>
	: T extends { fields: infer Fields } ? true extends { [K in keyof Fields]: HasTextureInput<Fields[K]> }[keyof Fields] ? true : false
	: false;
type ResolutionInputKeys<T> = Extract<{ [K in keyof T]: HasTextureInput<T[K]> extends true ? K : never }[keyof T], string>;
type IntrinsicResolutionSource = { kind: 'playerReference' } | { kind: 'assetReference'; assetType: 'image' | 'video' };
type NativeEffectLayout<D extends NativeEffectDefinition> = D extends { ui: { parameterLayout: infer L extends readonly EffectParameterLayoutItem[] } }
	? { ui: { parameterLayout: readonly EffectParameterLayoutItem<ParameterId<D>>[] & CheckedEffectParameterLayout<L, ParameterId<D>> } } : unknown;

/** 開発者が定義するNative Effectの参照IDとレイアウトは型検査で確定する。 */
export function defineNativeEffect<const D extends NativeEffectDefinition>(definition: D & NoInfer<NativeEffectLayout<D> & {
	staticSettingDefs?: { [K in keyof NonNullable<D['staticSettingDefs']>]: CheckedStaticSettingDefinition<NonNullable<D['staticSettingDefs']>[K]> };
	paramDefs: { [K in keyof D['paramDefs']]: CheckedParameterDefinition<D['paramDefs'][K]> };
	primaryInputParameter: MatchingKeys<D['paramDefs'], { canNode: true }> | null;
	primaryAudioInputParameter?: MatchingKeys<D['paramDefs'], { dataType: { kind: 'audioSource' } }> | null;
	primaryOutput: Extract<keyof D['outputDefs'], string> | null;
	resolutionInputParameters: readonly ResolutionInputKeys<D['paramDefs']>[];
	intrinsicResolutionSetting?: MatchingKeys<NonNullable<D['staticSettingDefs']>, { dataType: IntrinsicResolutionSource }>;
	outputDefs: { [K in keyof D['outputDefs']]: D['outputDefs'][K] & { readonly inputParameters?: readonly ParameterId<D>[] } };
}>): D {
	return definition;
}
