import type { StaticSettingDefinitions, StaticSettingDataType, StaticSettingValue } from '@gs/shared/static-setting.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';
import type { BlendMode } from '@gs/shared/color-blend.ts';
import type { ParameterDefinition } from '@gs/shared/parameter/parameter-definition.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { ColorRamp } from '@gs/shared/color-ramp.ts';
import type { SizeReference } from '@gs/shared/size-reference.ts';
import type { FileSource } from '@gs/shared/file-source.ts';
import type { ShaderInput } from '@gs/shared/gpu/shader-input.ts';
import type { FitMode, IntermediateTextureFormat, WrapMode } from '@gs/shared/types.ts';
import type { EffectOutputDefinitions, EffectDefinition } from './effect-definition.ts';
import type { EffectStatus } from './effect-status.ts';

// データの構造とパラメータ固有の設定を並行してたどる。
// 子の設定はdataTypeやUIを持たないが、canNodeの規約は最上位と同じ。
type RuntimeEffectOptionValue<D extends DataType, S> =
	S extends { canNode: true } ? ShaderInput :
	D extends { kind: 'scalar' } ? number :
	D extends { kind: 'bool' } ? boolean :
	D extends { kind: 'string' } ? string :
	D extends { kind: 'color' } ? Readonly<[number, number, number, number]> :
	D extends { kind: 'colorRamp' } ? ColorRamp :
	D extends { kind: 'vector' } ? Readonly<[number, number]> :
	D extends { kind: 'blendMode' } ? BlendMode :
	D extends { kind: 'fitMode' } ? FitMode :
	D extends { kind: 'sizeReference' } ? SizeReference :
	D extends { kind: 'wrapMode' } ? WrapMode :
	D extends { kind: 'enum'; options: readonly string[] } ? D['options'][number] :
	D extends { kind: 'audioSource' } ? AudioInput | null :
	D extends { kind: 'struct'; fields: infer F extends Record<string, DataType> }
		? S extends { fields: infer Settings }
			? { [K in keyof F]: RuntimeEffectOptionValue<F[K], K extends keyof Settings ? Settings[K] : never> }
			: never :
		D extends { kind: 'array'; elementType: infer E extends DataType }
			? S extends { element: infer Settings } ? RuntimeEffectOptionValue<E, Settings>[] : never :
			never;

// パラメータ定義を元にresolveされた実行時に実際に渡される値
export type RuntimeEffectParameters<T extends Record<string, ParameterDefinition>> = {
	[K in keyof T]: RuntimeEffectOptionValue<T[K]['dataType'], T[K]>;
};

export type EffectOutputData = {
	previousFrameTexture: GPUTexture | null;
	previousFrameTextureView: GPUTextureView | null;
	texture: GPUTexture;
	textureView: GPUTextureView;
};

// 遅延出力は未使用時には存在しない。定義を広い型で扱う場合も、
// trueの可能性が残るポートは、エフェクト側で確保の有無を確認する。
// 遅延ポートはマップのキー自体を省略するため、未確保の読み取り結果はundefinedになる。
export type EffectOutputDataMap<Outputs extends EffectOutputDefinitions> = {
	[K in keyof Outputs]: 'canLazyAllocation' extends keyof Outputs[K]
		? true extends Outputs[K]['canLazyAllocation'] ? EffectOutputData | undefined : EffectOutputData
		: EffectOutputData;
};

export type EffectGpuContext = {
	device: GPUDevice;
	defaultVertexShaderModule: GPUShaderModule;
	enable32bitDataTextures: boolean;
	intermediateTextureFormat: IntermediateTextureFormat;
};

export type EffectRenderContext<Options extends Record<string, ParameterDefinition> = any, Outputs extends EffectOutputDefinitions = any> = {
	/** 呼び出し側が選んだ時刻（秒）。式・キーの評価スコープはここでは決めない。 */
	time: number;
	/** 前回描画からの経過時間（ミリ秒）。 */
	timeDelta: number;
	pointerPosition: { x: number; y: number; };
	pointerVector: { x: number; y: number; };
	outputDataMap: EffectOutputDataMap<Outputs>;
	// この描画で必要な出力。定義済みのポート名だけを許可する。省略時は全出力を必要とする。
	usedOutputPorts?: ReadonlySet<Extract<keyof Outputs, string>>;
	commandEncoder: GPUCommandEncoder;
	createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => GPURenderPassEncoder;
	createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
	createComputePassEncoder: (commandEncoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor) => GPUComputePassEncoder;
	params: RuntimeEffectParameters<Options>;
};

export type EffectInstance<Options extends Record<string, ParameterDefinition> = any, Outputs extends EffectOutputDefinitions = any> = {
	readonly cacheVersion?: number;
	/** パラメータ変更による非同期の準備を開始する。完了はreportStatusで通知する。 */
	prepare?: (params: RuntimeEffectParameters<Options>, signal?: AbortSignal) => void;
	render: (ctx: EffectRenderContext<Options, Outputs>) => void;
	dispose: () => void;
};

export type EffectImplementation<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs' | 'staticSettingDefs'> = EffectDefinition, Options extends Record<string, ParameterDefinition> = Definition['paramDefs']> = {
	disableCache?: boolean;
	needsPreviousFrame?: boolean;

	outputTextureFactories: {
		// canLazyAllocation=trueのポートだけ遅延確保する。それ以外はレンダラー作成時に確保する。
		[K in keyof Definition['outputDefs']]: (args: {
			resolution: { width: number; height: number; };
			wgpu: {
				device: GPUDevice;
				enable32bitDataTextures: boolean;
				intermediateTextureFormat: IntermediateTextureFormat;
			};
		}) => GPUTexture;
	};
	shader?: string;
	init: (args: {
		reportStatus: (status: EffectStatus) => void;
		/** 計算用解像度（プレビュー倍率適用済み）。変更時はdispose後に再初期化する。 */
		resolution: { width: number; height: number; },
		wgpu: EffectGpuContext;
		params: RuntimeEffectParameters<Options>;
		resources: EffectStaticResources<Definition>;
		fallbackTexture: GPUTexture;
	}) => EffectInstance<Options, Definition['outputDefs']>;
};

export function implementEffect<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs' | 'staticSettingDefs'>>(def: EffectImplementation<Definition, Definition['paramDefs']>): EffectImplementation<Definition, Definition['paramDefs']> {
	return def;
}

// 保存するIDと借用するリソースを分離する。Playerの選択は固定でもフレームは更新される。
// 素材のID・寸法は呼び出し側で解決し、ファイルを読む実装には読み取り口だけを渡す。
type EffectStaticResource<T extends StaticSettingDataType> =
	T extends { kind: 'assetReference'; assetType: 'image' } ? GPUTexture | null :
	T extends { kind: 'assetReference' } ? FileSource | null :
	T extends { kind: 'playerReference' } ? { getVideoFrame: () => VideoFrame | null } | null : StaticSettingValue<T>;
export type EffectStaticResources<Definition extends { staticSettingDefs?: StaticSettingDefinitions }> = {
	readonly [Key in keyof NonNullable<Definition['staticSettingDefs']>]: EffectStaticResource<NonNullable<Definition['staticSettingDefs']>[Key]['dataType']>;
};
