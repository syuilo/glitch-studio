import type { DataType, TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { StaticSettingDefinitions } from '@gs/shared/static-setting.ts';

/** 配置のBindingは式や接続を持てるが、定義の初期値・追加用の要素は末端までliteralにする。 */
export type EffectParameterDefinition<T extends DataType = DataType> = ParameterDefinition<T, never>;

/** Recordのキーは配線・保存用の固定ID。表示名や実装内で参照する名前から独立させる。 */
export interface EffectDefinition {
	readonly paramDefs: Readonly<Record<string, EffectParameterDefinition>>;
	readonly outputDefs: Readonly<Record<string, { dataType: TextureDataType; label?: string }>>;
	readonly primaryInputParameter: string | null;
	readonly primaryOutput: string | null;
	readonly primaryAudioInputParameter?: string | null;
	readonly resolutionInputParameters: readonly string[];
	readonly staticSettingDefs?: StaticSettingDefinitions;
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
}
