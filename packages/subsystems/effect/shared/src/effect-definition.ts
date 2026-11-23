import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CheckedStaticSettingDefinition, StaticSettingDefinitions } from '@gs/shared/static-setting.ts';
import type { CheckedEffectParameterLayout, EffectParameterLayoutItem } from './effect-parameter-layout.ts';

/** Recordのキーは配線・保存用の固定ID。表示名や実装内で参照する名前から独立させる。 */
export interface EffectDefinition {
	readonly paramDefs: Readonly<Record<string, ParameterDefinition>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; label?: string }>>;
	/** バイパス・自動接続に使うトップレベルの入力。主入力がないEffectはnull。 */
	readonly primaryInputParameter: string | null;
	readonly primaryOutput: string | null;
	/** 音声の自動割当先。画像のバイパス・合成方法・解像度とは独立する。 */
	readonly primaryAudioInputParameter?: string | null;
	/** 自動解像度に使う入力。配列・構造体の配下もたどり、接続のうち画素数が最大の寸法を採用する。 */
	readonly resolutionInputParameters: readonly string[];
	readonly staticSettingDefs?: StaticSettingDefinitions;
	/** 原寸は静的設定が参照する画像・動画Assetのメタデータから取得する。 */
	readonly intrinsicResolutionSetting?: string;
	/** 省略時はparamDefsの定義順。指定時は全パラメータを一度ずつ配置する。 */
	readonly ui?: { readonly parameterLayout: readonly EffectParameterLayoutItem[] };
	/** 入力を持つ生成Effectも含め、レイヤー作成時の主入力と合成方法はこの種別に従う。 */
	readonly kind: 'generate' | 'modify';
}

/** Native Effectの検索・表示と、履歴を持つ配置の識別に使うカタログ情報。 */
export interface NativeEffectDefinition extends EffectDefinition {
	/** ポートの画素を求める入力。省略時は全入力。寸法だけの依存はresolutionInputParametersで指定する。 */
	readonly outputDefs: Readonly<Record<string, EffectDefinition['outputDefs'][string] & { readonly inputParameters?: readonly string[] }>>;
	readonly displayName: string;
	/** 説明の翻訳漏れを定義時に検出できるよう、日本語・英語の両方を必須にする。 */
	readonly summary: Readonly<Record<'ja-JP' | 'en-US', string>>;
	readonly tags: readonly string[];
	/**
	 * 自身の過去の描画で更新した履歴・蓄積状態に依存する。
	 * 評価時刻・現在の入力・パラメータが同じでも、それまでの描画回数・順序・間隔により
	 * 出力が変わり得るため、時間方向に複数回評価するときに注意が必要なNative Effectを識別する。
	 * 一部の設定でのみ履歴を使う場合もtrueとする。上流や外部の履歴は現在の入力として扱う。
	 * 描画キャッシュやGPUリソースの再利用は、ここでいう履歴・蓄積状態とは区別する。
	 */
	readonly dependsOnRenderHistory: boolean;
	/** 設定・入力・解像度によって単一のRender Passが長時間実行になる可能性がある。trueのとき自動タイル制御の対象にする。 */
	readonly canHaveLongRunningRenderPass?: boolean;
}

type ParameterId<D extends NativeEffectDefinition> = Extract<keyof D['paramDefs'], string>;
type MatchingKeys<T, Shape> = Extract<{ [K in keyof T]: T[K] extends Shape ? K : never }[keyof T], string>;
// コンテナ自体は接続を受け取らないため、子の定義をたどって接続可能な末端を探す。
type HasTextureInput<T> = T extends { canNode: true } ? true
	: T extends { element: infer Element } ? HasTextureInput<Element>
	: T extends { fields: infer Fields } ? true extends { [K in keyof Fields]: HasTextureInput<Fields[K]> }[keyof Fields] ? true : false
	: false;
type ResolutionInputKeys<T> = Extract<{ [K in keyof T]: HasTextureInput<T[K]> extends true ? K : never }[keyof T], string>;
type IntrinsicResolutionSource = { kind: 'assetReference'; assetType: 'image' | 'video' };
type NativeEffectLayout<D extends NativeEffectDefinition> = D extends { ui: { parameterLayout: infer L extends readonly EffectParameterLayoutItem[] } }
	? { ui: { parameterLayout: readonly EffectParameterLayoutItem<ParameterId<D>>[] & CheckedEffectParameterLayout<L, ParameterId<D>> } } : unknown;

/**
 * 開発者が定義するNative Effectの参照IDとレイアウトは型検査で確定する。
 * NoInferにより、参照先の検査に合わせて具体的な定義が広い型に推論されるのを防ぐ。
 */
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
