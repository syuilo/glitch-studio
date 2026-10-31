import type { StaticSettingDefinitions } from '@gs/shared/static-setting.ts';
import { validateStaticSettingValue } from '@gs/shared/static-setting.ts';
import { getArrayElementDefinition, getStructFieldDefinitions } from '@gs/shared/parameter/parameter-definition.ts';
import type { TextureDataType } from '@gs/shared/data-type/data-type.ts';
import type { CheckedParameterDefinition, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';

export type EffectOutputDefinitions = Record<string, {
	dataType: TextureDataType;

	// trueの出力のみ、必要になるまで確保を遅らせ、未使用になったら解放する。
	canLazyAllocation?: boolean;
}>;

/**
 * 用途・見た目からエフェクトを検索するためのタグ。複数の観点を重ねて付けられる。
 * 生成／加工や入出力型は既存の定義から判定できるため、タグには重複して持たせない。
 */
export const EFFECT_TAGS = [
	'color', // 色・チャンネル
	'composite', // 合成・ミックス
	'transform', // 移動・回転・拡縮
	'distortion', // 歪み・変形
	'blur', // ぼかし
	'light', // 光・発光
	'glitch', // 映像の乱れ・破損を模した表現
	'pixel', // ピクセル・ブロック
	'pattern', // 繰り返し模様・幾何学的なパターン
	'gradient', // 見た目の階調変化。微分としての勾配計算はmathに分類する。
	'noise', // ノイズ
	'liquid', // 水・液体
	'typography', // 文字・記号
	'temporal', // 過去フレームや入力の履歴を使う処理。単にアニメーション可能なだけでは付けない。
	'audio', // 音声ビジュアライズ
	'analysis', // 解析・計測
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

export type EffectDefinition<In extends Record<string, ParameterDefinition> = Record<string, ParameterDefinition>, Out extends EffectOutputDefinitions = EffectOutputDefinitions, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> = {
	id: string;
	displayName: string;
	// 説明の翻訳漏れを定義時に検出できるよう、日本語・英語の両方を必須にする。
	description: Record<'ja-JP' | 'en-US', string>;
	// レイヤー作成時の主入力と合成方法を決める。入力の有無からは推測しない。
	kind: 'modify' | 'generate';
	/**
	 * 自身の過去の描画で更新した履歴・蓄積状態に依存する。
	 * 評価時刻・現在の入力・パラメータが同じでも、それまでの描画回数・順序・間隔により
	 * 出力が変わり得るため、時間方向の複数回評価などで注意が必要なエフェクトを識別する。
	 * 一部の設定でのみ履歴を使う場合もtrueとする。上流エフェクトの履歴依存は含めない。
	 * 単なる描画キャッシュ・GPUリソースの再利用や、外部から渡された履歴の読み取りは含めない。
	 * needsPreviousFrameによる共通管理と、エフェクト内部での独自管理のどちらも対象とする。
	 */
	dependsOnRenderHistory: boolean;
	tags: EffectTags[];
	paramDefs: In;
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

export function defineEffect<const In extends Record<string, ParameterDefinition>, const Out extends EffectOutputDefinitions, const Settings extends StaticSettingDefinitions = Record<never, never>>(
	def: EffectDefinition<In, Out, Settings> & {
		paramDefs: { [K in keyof In]: CheckedParameterDefinition<NoInfer<In[K]>> };
	},
): EffectDefinition<In, Out, Settings> {
	if (def.primaryAudioInputParameter != null && def.paramDefs[def.primaryAudioInputParameter]?.dataType.kind !== 'audioSource') {
		throw new Error(`Primary audio input must reference an audio parameter: ${def.id}.${def.primaryAudioInputParameter}`);
	}
	// 必須の主入出力はnullで未選択、解像度入力は空配列で未選択を表す。
	// 画像の主入力は接続を受け取るため、通常の数値設定やコンテナは指定できない。
	if (def.primaryInputParameter !== null && def.paramDefs[def.primaryInputParameter]?.canNode !== true) {
		throw new Error(`Primary input must reference a node-capable parameter: ${def.id}.${def.primaryInputParameter}`);
	}
	if (def.primaryOutput !== null && !Object.hasOwn(def.outputDefs, def.primaryOutput)) {
		throw new Error(`Primary output must reference an existing output: ${def.id}.${def.primaryOutput}`);
	}
	for (const key of def.resolutionInputParameters) {
		if (def.paramDefs[key] == null || !hasResolutionInput(def.paramDefs[key])) throw new Error(`Resolution input must contain a node-capable parameter: ${def.id}.${key}`);
	}
	for (const setting of Object.values(def.staticSettingDefs ?? {})) validateStaticSettingValue(setting, setting.defaultValue);
	if (def.intrinsicResolutionSetting != null) {
		const setting = def.staticSettingDefs?.[def.intrinsicResolutionSetting];
		if (setting == null || !(setting.dataType.kind === 'playerReference' || (setting.dataType.kind === 'assetReference' && ['image', 'video'].includes(setting.dataType.assetType)))) {
			throw new Error(`Intrinsic resolution must reference an image, video, or Player setting: ${def.id}`);
		}
	}
	return def;
}

function hasResolutionInput(definition: ParameterDefinition): boolean {
	if (definition.dataType.kind === 'array') return hasResolutionInput(getArrayElementDefinition(definition));
	if (definition.dataType.kind === 'struct') return Object.values(getStructFieldDefinitions(definition)).some(hasResolutionInput);
	return definition.canNode === true;
}
