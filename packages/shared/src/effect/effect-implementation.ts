import type { AudioHistory } from '../audio-history.ts';
import type { ParameterDefinition_Scalar, ParameterDefinition_Boolean, ParameterDefinition_Color, ParameterDefinition_Vector, ParameterDefinition_BlendMode, ParameterDefinition_FitMode, ParameterDefinition_WrapMode, ParameterDefinition_Enum, ParameterDefinition_AssetReference, ParameterDefinition_VideoAssetReference, ParameterDefinition_PlayerReference, ParameterDefinition_Struct, ParameterDefinition_Array, ParameterDefinition } from '../parameter.ts';
import type { ShaderInput } from '../shader-input.ts';
import type { Asset, FitMode, IntermediateTextureFormat, WrapMode } from '../types.ts';
import type { EffectOutputDefinitions, EffectDefinition } from './effect-definition.ts';
import type { EffectStatus } from './effect-status.ts';

type RuntimeEffectOptionScalarValue<T extends ParameterDefinition> =
	// canNodeは常に定数または接続情報を持つShaderInput。構造体・配列内でも同じ規約を使う。
	T extends { canNode: true } ? ShaderInput :
	T extends ParameterDefinition_Scalar ? number :
	T extends ParameterDefinition_Boolean ? boolean :
	T extends ParameterDefinition_Color ? Readonly<[number, number, number, number]> :
	T extends ParameterDefinition_Vector ? Readonly<[number, number]> :
	T extends ParameterDefinition_BlendMode ? string :
	T extends ParameterDefinition_FitMode ? FitMode :
	T extends ParameterDefinition_WrapMode ? WrapMode :
	T extends ParameterDefinition_Enum ? T['options'][number]['value'] :
	T extends ParameterDefinition_AssetReference ? GPUTexture | null :
	T extends ParameterDefinition_VideoAssetReference ? Pick<Asset, 'id' | 'fileData'> | null :
	T extends ParameterDefinition_PlayerReference ? { videoFrame: VideoFrame | null; audio: AudioHistory | null; } | null :
	T extends ParameterDefinition_Struct ? {
		[K in keyof T['fields']]: RuntimeEffectOptionValue<T['fields'][K]>;
	} :
	never;

type RuntimeEffectOptionValue<T extends ParameterDefinition> = T extends unknown ?
	T extends ParameterDefinition_Array ? RuntimeEffectOptionValue<T['item']>[] : RuntimeEffectOptionScalarValue<T> :
	never;

// パラメータ定義を元にresolveされた実行時に実際に渡される値
type GetRuntimeEffectOptionsSchemaValues<T extends Record<string, ParameterDefinition>> = {
	[K in keyof T]: RuntimeEffectOptionValue<T[K]>;
};

export type EffectInstance<Options extends Record<string, ParameterDefinition> = any, Outputs extends EffectOutputDefinitions = any> = {
	readonly cacheVersion?: number;
	/** パラメータ変更による非同期の準備を開始する。完了はreportStatusで通知する。 */
	prepare?: (params: GetRuntimeEffectOptionsSchemaValues<Options>) => void;
	render: (ctx: {
		time: number;
		timeDelta: number;
		pointerPosition: { x: number; y: number; };
		pointerVector: { x: number; y: number; };
		outputDataMap: {
			[K in keyof Outputs]: {
				previousFrameTexture?: GPUTexture;
				previousFrameTextureView?: GPUTextureView;
				texture: GPUTexture;
				textureView: GPUTextureView;
			};
		};
		// この描画で必要な出力。定義済みのポート名だけを許可する。省略時は全出力を必要とする。
		usedOutputPorts?: ReadonlySet<Extract<keyof Outputs, string>>;
		commandEncoder: GPUCommandEncoder;
		createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => GPURenderPassEncoder;
		createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
		createComputePassEncoder: (commandEncoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor) => GPUComputePassEncoder;
		params: GetRuntimeEffectOptionsSchemaValues<Options>;
	}) => void;
	dispose: () => void;
};

export type EffectImplementation<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'> = EffectDefinition, Options extends Record<string, ParameterDefinition> = Definition['paramDefs']> = {
	disableCache?: boolean;
	needsPreviousFrame?: boolean;
	/** 入力に合わせて出力サイズを決めるエフェクト用。未指定またはundefinedを返す場合は描画先の解像度を使う。 */
	getOutputResolution?: (params: GetRuntimeEffectOptionsSchemaValues<Options>, outputPort: Extract<keyof Definition['outputs'], string>) => { width: number; height: number } | undefined;
	outputTextureFactories: {
		// canLazyAllocation=trueのポートだけ遅延確保する。それ以外はノード追加時に確保する。
		[K in keyof Definition['outputs']]: (args: {
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
		resolution: { width: number; height: number; },
		wgpu: {
			device: GPUDevice;
			context: GPUCanvasContext;
			defaultVertexShaderModule: GPUShaderModule;
			enable32bitDataTextures: boolean;
			intermediateTextureFormat: IntermediateTextureFormat;
		};
		params: GetRuntimeEffectOptionsSchemaValues<Options>;
		fallbackTexture: GPUTexture;
	}) => EffectInstance<Options, Definition['outputs']>;
};

export function implementEffect<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'>>(def: EffectImplementation<Definition, Definition['paramDefs']>): EffectImplementation<Definition, Definition['paramDefs']> {
	return def;
}
