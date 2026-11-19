import type { CheckedStaticSettingDefinition, StaticSettingDefinitions } from '@gs/shared/static-setting.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { CheckedEffectParameterLayout, EffectParameterLayoutItem } from './effect-parameter-layout.ts';

export type EffectOutputDefinitions = Record<string, {
	dataType: TextureDataType;
	label?: string;
}>;

/**
 * 用途・見た目からエフェクトを検索するためのタグ。複数の観点を重ねて付けられる。
 * 生成／加工や入出力型は既存の定義から判定できるため、タグには重複して持たせない。
 */
export const EFFECT_TAGS = [
	'color', // 色・チャンネル
	'composite', // 合成・ミックス
	'transition', // 画像間の切り替え・場面転換
	'transform', // 移動・回転・拡縮
	'distortion', // 歪み・変形
	'3d', // 3次元空間・立体形状の描画や加工。高さ場の照明や曲面の陰影・屈折も含む。
	'blur', // ぼかし
	'light', // 光・発光
	'glitch', // 映像の乱れ・破損を模した表現
	'pattern', // 繰り返し模様・幾何学的なパターン
	'fractal', // 自己相似・再帰的な模様やフラクタルノイズ
	'gradient', // 見た目の階調変化。微分としての勾配計算はmathに分類する。
	'noise', // ノイズ
	'liquid', // 水・液体
	'typography', // 文字・記号
	'temporal', // 過去フレームや入力の履歴を使う処理。単にアニメーション可能なだけでは付けない。
	'audio', // 音声ビジュアライズ
	'analysis', // 解析・計測
	'simulation', // 運動・光の伝播や干渉など、物理モデルに基づく現象の計算。見た目を模すだけでは付けない。
	'math', // 演算・データ処理
	'sdf', // 符号付き距離場の生成・変換・合成・描画
	'media', // 画像・動画などのメディア入力
	'utility', // 組み立て・調整・動作確認を補助する処理。その他の分類の受け皿にはしない。
	'convert', // 型・表現の変換が主目的の処理。入出力型が異なるだけでは付けない。
	'gimmicky', // 特徴的な仕掛けやクセの強い視覚表現
	'stylized', // 特定の画風・質感を作る表現
	'experimental', // 抽象的・実験的な視覚表現。実装の未完成・不安定さは表さない。
] as const;

export type EffectTags = typeof EFFECT_TAGS[number];

// 一覧やレンダラーで使う一般のRecordはキーを限定しない。
// 具体的な定義では、存在するキーに加えて参照先の用途まで型で絞り込む。
type NodeCapableParameterKeys<In extends Record<string, ParameterDefinition>> = string extends keyof In ? string : Extract<{
	[Key in keyof In]: In[Key] extends { canNode: true } ? Key : never;
}[keyof In], string>;

type AudioInputParameterKeys<In extends Record<string, ParameterDefinition>> = string extends keyof In ? string : Extract<{
	[Key in keyof In]: In[Key]['dataType'] extends { kind: 'audioSource' } ? Key : never;
}[keyof In], string>;

// コンテナ自体は接続を受け取らない。子の設定をたどり、末端に接続可能な入力があるかを調べる。
type HasResolutionInput<Settings> = Settings extends { canNode: true } ? true :
	Settings extends { element: infer Element } ? HasResolutionInput<Element> :
		Settings extends { fields: infer Fields }
			? true extends { [Key in keyof Fields]: HasResolutionInput<Fields[Key]> }[keyof Fields] ? true : false
			: false;

type ResolutionInputParameterKeys<In extends Record<string, ParameterDefinition>> = string extends keyof In ? string : Extract<{
	[Key in keyof In]: HasResolutionInput<In[Key]> extends true ? Key : never;
}[keyof In], string>;

type IntrinsicResolutionSettingKeys<Settings extends StaticSettingDefinitions> = string extends keyof Settings ? string : Extract<{
	[Key in keyof Settings]: Settings[Key]['dataType'] extends { kind: 'playerReference' } | { kind: 'assetReference'; assetType: 'image' | 'video' } ? Key : never;
}[keyof Settings], string>;

export type EffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> = {
	kind: 'modify' | 'generate';
	paramDefs: In;
	ui?: {
		// 省略時はparamDefsの定義順。指定時は全パラメータを一度ずつ配置する。
		parameterLayout: readonly EffectParameterLayoutItem<Extract<keyof NoInfer<In>, string>>[];
	};
	staticSettingDefs?: Settings;
	/** 原寸の取得元。静的設定の参照先メタデータだけから取得する。 */
	intrinsicResolutionSetting?: Extract<keyof Settings, string>;
	// バイパス・自動接続に使うトップレベルの入力。主入力がないエフェクトはnull。
	primaryInputParameter: Extract<keyof In, string> | null;
	/** 音声の自動割当先。画像のバイパス・合成方法・解像度とは独立する。 */
	primaryAudioInputParameter?: Extract<keyof In, string> | null;
	/** 自動解像度に使う入力。配列・構造体では配下の全接続の最大画素数を採用する。 */
	resolutionInputParameters: readonly Extract<keyof In, string>[];
	outputDefs: Out;
	primaryOutput: Extract<keyof NoInfer<Out>, string> | null;
};

/** Native Effectのカタログ情報と固有の実行特性。インライン定義には登録IDや履歴フラグを要求しない。 */
export type NativeEffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> = EffectDefinition<In, Out, Settings> & {
	id: string;
	displayName: string;
	summary: Record<'ja-JP' | 'en-US', string>;
	tags: readonly EffectTags[];
	dependsOnRenderHistory: boolean;
	canHaveLongRunningRenderPass?: boolean;
};

export function defineNativeEffect<
	const In extends Record<string, ParameterDefinition>,
	const Out extends EffectOutputDefinitions,
	const Settings extends StaticSettingDefinitions = Record<never, never>,
	const Layout extends readonly EffectParameterLayoutItem[] = readonly EffectParameterLayoutItem[],
>(
	def: NativeEffectDefinition<In, Out, Settings> & {
		paramDefs: { [K in keyof In]: CheckedParameterDefinition<NoInfer<In[K]>> };
		staticSettingDefs?: { [Key in keyof Settings]: CheckedStaticSettingDefinition<NoInfer<Settings[Key]>> };
		// 詳細な整合性は定義を作る境界で検査する。返却後は異なる定義を共通の型で扱えるようにする。
		primaryInputParameter: NodeCapableParameterKeys<NoInfer<In>> | null;
		primaryAudioInputParameter?: AudioInputParameterKeys<NoInfer<In>> | null;
		resolutionInputParameters: readonly ResolutionInputParameterKeys<NoInfer<In>>[];
		intrinsicResolutionSetting?: IntrinsicResolutionSettingKeys<NoInfer<Settings>>;
		// Layoutはここからだけ推論し、検証結果に合わせて広い配列型へ逃げるのを防ぐ。
		ui?: { parameterLayout: Layout & CheckedEffectParameterLayout<NoInfer<Layout>, Extract<keyof NoInfer<In>, string>> };
	},
): NativeEffectDefinition<In, Out, Settings> {
	return def;
}
