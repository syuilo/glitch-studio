import type { ShaderInput, TextureShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { UniformValue } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingDataType, StaticSettingDefinitions, StaticSettingValue, StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { VideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { EffectRenderTilingProgressObserver, EffectRenderWorkloadHint } from '@gs/subsystems_effect_shared/effect-render-tiling.ts';
import type { ParameterDefaultValue, ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@gs/subsystems_effect_shared/custom-node-graph-effect.ts';

/** 寸法は配置中固定する。textureとversionは描画後に最新のものを取得する。 */
export type EffectTextureOutput = {
	readonly kind: 'texture';
	readonly resolution: Resolution;
	readonly texture: GPUTexture;
	readonly version?: number;
};

type EffectTextureInput = TextureShaderInput & Pick<EffectTextureOutput, 'version'>;

/** 種別と寸法は配置の寿命中固定する。値・借用テクスチャはgetterでフレームごとの内容を渡せる。 */
export type EffectParameterInput<TextureInput extends EffectTextureOutput = EffectTextureInput> =
	| Readonly<UniformValue>
	| TextureInput
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'array'; readonly elements: readonly EffectParameterInput<TextureInput>[] }
	| { readonly kind: 'struct'; readonly fields: Readonly<Record<string, EffectParameterInput<TextureInput>>> };

export interface EffectFrameContext {
	/** 呼び出し側が選んだ内容時刻（秒）。 */
	readonly time: number;
	/** 前回描画からの経過時間（ミリ秒）。 */
	readonly timeDelta: number;
	readonly endTime?: number;
	readonly isExport?: boolean;
	/** 内容時刻と独立した表示区間の進行率。Timelineでは呼び出し側で計算する。 */
	readonly progress?: number;
	/** 中央原点・上が+Y・配置の描画領域の長辺を1とする共通座標。各ノードの寸法へ換算する。両軸が-999以下なら未入力。 */
	readonly pointerPosition?: readonly [number, number];
	/** pointerPositionと同じ共通単位で測った移動量。 */
	readonly pointerVector?: readonly [number, number];
}

export interface EffectRenderContext extends EffectFrameContext {
	readonly commandEncoder: GPUCommandEncoder;
}

export interface EffectRenderOperation {
	/** 同期で準備済みならvoid。非同期処理はsignalが中断された後に結果を反映しない。 */
	prepare?(frame: EffectFrameContext, signal: AbortSignal): void | Promise<void>;
	/** 入力以外の状態を含む変更世代。省略したNative Effectは毎回描画する。 */
	readonly cacheKey?: string | number;
	/** 自動タイル制御の対象で呼ぶ。評価済みの値から負荷を見積もる。描画と履歴の更新はrenderで行う。 */
	getRenderWorkloadHint?(): EffectRenderWorkloadHint | null;
	render(context: EffectRenderContext): void;
	/** 記録したパスが中断・破棄された場合、再生成できる中間結果を次の描画で計算し直す。 */
	invalidateRenderCache?(): void;
	resetRenderHistory?(): void;
	dispose(): void;
}

export type EffectPreparationStatus = { type: 'idle' | 'loading' | 'ready' } | { type: 'error'; error: unknown };

export type CustomNodeGraphEffectValueUpdate =
	| { nodeId: string; params: CustomNodeGraphEffectEffectNode['params'] }
	| { customParameterValues: CustomNodeGraphEffect['customParameterValues'] };

export interface EffectInstance {
	readonly preparationStatus: EffectPreparationStatus;
	/** 同期描画用。準備中はfalseを返し、失敗時は準備処理の診断をそのまま送出する。 */
	tryPrepare(frame: EffectFrameContext): boolean;
	prepare(frame: EffectFrameContext, signal?: AbortSignal): Promise<void>;
	/** 通常描画は呼び出し側のencoderへ記録する。出力を読むコマンドも次の描画・破棄の前に呼び出し側でsubmitする。 */
	render(frame: EffectRenderContext): void;
	render(frame: EffectFrameContext, commandEncoder: GPUCommandEncoder): void;
	renderTiled(frame: EffectFrameContext, signal?: AbortSignal, onProgress?: EffectRenderTilingProgressObserver): Promise<void>;
	readonly dependsOnRenderHistory: boolean;
	/** フレーム間で、配線・入力構造が同じ配置の値を更新する。nullはルートのinline Custom Node Graph Effectを指す。 */
	updateCustomNodeGraphEffectValues(customNodeGraphEffectId: string | null, update: CustomNodeGraphEffectValueUpdate): void;
	resetRenderHistory(): void;
	dispose(): void;
	/** 要求されたポートのうち、テクスチャを出力するものだけを持つ。所有権は移さない。 */
	readonly outputs: ReadonlyMap<string, EffectTextureOutput>;
}

export interface EffectGpuContext {
	readonly device: GPUDevice;
	/** triangle-listとdraw(3)で全画面を覆い、location(0)に各軸[-1, +1]の画像参照座標を渡す。 */
	readonly defaultVertexShaderModule: GPUShaderModule;
	readonly enable32bitDataTextures: boolean;
}

// データの構造とパラメータの定義を並行してたどり、子の設定にも同じcanNodeの規約を適用する。
type NativeEffectInput<D extends DataType, Settings> = Settings extends { canNode: true } ? ShaderInput
	: D extends { kind: 'array'; elementType: infer Element extends DataType } ? {
		readonly kind: 'array';
		readonly elements: readonly NativeEffectInput<Element, Settings extends { element: infer S } ? S : never>[];
	} : D extends { kind: 'struct'; fields: infer Fields extends Record<string, DataType> } ? {
		readonly kind: 'struct';
		readonly fields: { readonly [Key in keyof Fields]: NativeEffectInput<Fields[Key], Settings extends { fields: infer S } ? S[Key & keyof S] : never> };
	} : { readonly kind: 'value'; readonly value: D extends { kind: 'audioSource' } ? AudioInput | null : ParameterDefaultValue<D> };

type EffectStaticResource<T extends StaticSettingDataType> =
	T extends { kind: 'assetReference'; assetType: 'image' } ? GPUTexture | null :
	T extends { kind: 'assetReference' } ? FileSource | null :
	T extends { kind: 'playerReference' } ? { getVideoTexture: () => VideoFrameTexture | null } | null : StaticSettingValue<T>;
export type EffectStaticResources<D extends { readonly staticSettingDefs?: StaticSettingDefinitions }> = {
	readonly [K in keyof NonNullable<D['staticSettingDefs']>]: EffectStaticResource<NonNullable<D['staticSettingDefs']>[K]['dataType']>;
};

export interface EffectInitContext<Inputs = Readonly<Record<string, EffectParameterInput>>, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> extends EffectGpuContext {
	readonly signal?: AbortSignal;
	/** 出力の確保前に静的に決めた計算用解像度。プレビュー・書き出しの倍率を含む。 */
	readonly resolution: Resolution;
	readonly inputs: Inputs;
	readonly staticSettings: StaticSettingValues;
	/** 静的設定の実行時の値。Assetの参照IDは借用リソースに解決する。Playerの選択は配置中固定し、フレームはgetterで取得する。 */
	readonly resources: EffectStaticResources<{ staticSettingDefs: Settings }>;
	/** 使用する出力だけを初期化時に確保する。テクスチャの寿命はレンダラーが管理する。 */
	readonly outputTextures: ReadonlyMap<string, GPUTexture>;
}

type NativeEffectInputs<Params extends Readonly<Record<string, ParameterDefinition>>> = {
	readonly [Key in keyof Params]: NativeEffectInput<Params[Key]['dataType'], Params[Key]>;
};

export interface NativeEffectImplementation<Params extends Readonly<Record<string, ParameterDefinition>> = Readonly<Record<string, ParameterDefinition>>,
	ConditionalInputs extends keyof Params = never, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> {
	/** computeなど、標準の描画用テクスチャ以外を必要とする実装が指定する。 */
	createOutputTexture?(id: string, resolution: Resolution, gpu: EffectGpuContext): GPUTexture;
	init(context: EffectInitContext<string extends keyof Params ? Readonly<Record<string, EffectParameterInput>>
	: Omit<NativeEffectInputs<Params>, ConditionalInputs> & Partial<Pick<NativeEffectInputs<Params>, ConditionalInputs>>, Settings>,
		/** 描画後に同じ寸法・形式の別テクスチャを公開する。所有権は移さない。 */
		publishOutputTextures: ReadonlyMap<string, (texture: GPUTexture) => void>): EffectRenderOperation | Promise<EffectRenderOperation>;
}
