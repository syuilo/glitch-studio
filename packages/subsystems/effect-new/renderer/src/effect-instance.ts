import type { FixedShaderInput, ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingDataType, StaticSettingDefinitions, StaticSettingValue, StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { VideoFrameTexture } from '@gs/shared/media/video-texture.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { EffectRenderTilingProgressObserver, EffectRenderWorkloadHint } from '@gs/subsystems_effect-new_shared/effect-render-tiling.ts';
import type { ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';
import type { CustomNodeGraphEffect, CustomNodeGraphEffectEffectNode } from '@gs/subsystems_effect-new_shared/custom-node-graph-effect.ts';

/** 種別と寸法は配置の寿命中固定する。値・借用テクスチャはgetterでフレームごとの内容を渡せる。 */
export type EffectImageInput =
	| { readonly kind: 'uniform'; readonly value: readonly number[] }
	| { readonly kind: 'texture'; readonly resolution: Resolution; readonly texture: GPUTexture; readonly sampling?: ShaderInputSampling; readonly version?: number };

export function toFixedShaderInput(input: EffectImageInput): FixedShaderInput {
	if (input.kind === 'uniform') return input;
	const sampling = input.sampling ?? { fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' };
	return { kind: 'texture', ...sampling, resolution: input.resolution, get texture() { return input.texture; } };
}

export type EffectParameterInput =
	| EffectImageInput
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'array'; readonly elements: readonly EffectParameterInput[] }
	| { readonly kind: 'struct'; readonly fields: Readonly<Record<string, EffectParameterInput>> };

export interface EffectFrameContext {
	readonly time: number;
	readonly timeDelta: number;
	readonly endTime?: number;
	readonly isExport?: boolean;
	readonly progress?: number;
	/** 配置の描画領域の長辺を1とする共通座標。内部ノードには各ノードの寸法へ換算して渡す。 */
	readonly pointerPosition?: readonly [number, number];
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
	tryPrepare(frame: EffectFrameContext): boolean;
	prepare(frame: EffectFrameContext, signal?: AbortSignal): Promise<void>;
	render(frame: EffectRenderContext): void;
	render(frame: EffectFrameContext, commandEncoder: GPUCommandEncoder): void;
	renderTiled(frame: EffectFrameContext, signal?: AbortSignal, onProgress?: EffectRenderTilingProgressObserver): Promise<void>;
	readonly dependsOnRenderHistory: boolean;
	/** フレーム間で、配線・入力構造が同じ配置の値を更新する。nullはルートのinline Custom Node Graph Effectを指す。 */
	updateCustomNodeGraphEffectValues(customNodeGraphEffectId: string | null, update: CustomNodeGraphEffectValueUpdate): void;
	resetRenderHistory(): void;
	dispose(): void;
	/** 要求された接続済みポート。値の読み取りは描画を起動せず、所有権も移さない。 */
	readonly outputs: ReadonlyMap<string, EffectImageInput>;
}

export interface EffectGpuContext {
	readonly device: GPUDevice;
	readonly defaultVertexShaderModule: GPUShaderModule;
	readonly enable32bitDataTextures: boolean;
}

type NativeEffectInput<D extends DataType, Settings> = Settings extends { canNode: true } ? EffectImageInput
	: D extends { kind: 'array'; elementType: infer Element extends DataType } ? {
		readonly kind: 'array';
		readonly elements: readonly NativeEffectInput<Element, Settings extends { element: infer S } ? S : never>[];
	} : D extends { kind: 'struct'; fields: infer Fields extends Record<string, DataType> } ? {
		readonly kind: 'struct';
		readonly fields: { readonly [Key in keyof Fields]: NativeEffectInput<Fields[Key], Settings extends { fields: infer S } ? S[Key & keyof S] : never> };
	} : { readonly kind: 'value'; readonly value: D extends { kind: 'audioSource' } ? AudioInput | null : ParameterDefaultValue<D>['value'] };

type EffectStaticResource<T extends StaticSettingDataType> =
	T extends { kind: 'assetReference'; assetType: 'image' } ? GPUTexture | null :
	T extends { kind: 'assetReference' } ? FileSource | null :
	T extends { kind: 'playerReference' } ? { getVideoTexture: () => VideoFrameTexture | null } | null : StaticSettingValue<T>;
export type EffectStaticResources<D extends { readonly staticSettingDefs?: StaticSettingDefinitions }> = {
	readonly [K in keyof NonNullable<D['staticSettingDefs']>]: EffectStaticResource<NonNullable<D['staticSettingDefs']>[K]['dataType']>;
};

export interface EffectInitContext<Inputs = Readonly<Record<string, EffectParameterInput>>, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> extends EffectGpuContext {
	readonly signal?: AbortSignal;
	readonly resolution: Resolution;
	readonly inputs: Inputs;
	readonly staticSettings: StaticSettingValues;
	readonly resources: EffectStaticResources<{ staticSettingDefs: Settings }>;
	/** 使用する出力だけを初期化時に確保する。テクスチャの寿命はレンダラーが管理する。 */
	readonly outputTextures: ReadonlyMap<string, GPUTexture>;
}

type NativeEffectInputs<Params extends Readonly<Record<string, EffectParameterDefinition>>> = {
	readonly [Key in keyof Params]: NativeEffectInput<Params[Key]['dataType'], Params[Key]>;
};

export interface NativeEffectImplementation<Params extends Readonly<Record<string, EffectParameterDefinition>> = Readonly<Record<string, EffectParameterDefinition>>,
	ConditionalInputs extends keyof Params = never, Settings extends StaticSettingDefinitions = StaticSettingDefinitions> {
	/** computeなど、標準の描画用テクスチャ以外を必要とする実装が指定する。 */
	createOutputTexture?(id: string, resolution: Resolution, gpu: EffectGpuContext): GPUTexture;
	init(context: EffectInitContext<string extends keyof Params ? Readonly<Record<string, EffectParameterInput>>
	: Omit<NativeEffectInputs<Params>, ConditionalInputs> & Partial<Pick<NativeEffectInputs<Params>, ConditionalInputs>>, Settings>,
		/** 描画後に同じ寸法・形式の別テクスチャを公開する。所有権は移さない。 */
		publishOutputTextures: ReadonlyMap<string, (texture: GPUTexture) => void>): EffectRenderOperation | Promise<EffectRenderOperation>;
}
