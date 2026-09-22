import type { ShaderInput } from './shader-input.ts';
import type { ArrayOptionSchema, BlendModeOptionSchema, FitModeOptionSchema, BooleanOptionSchema, ColorOptionSchema, EffectDefinition, EffectOptionsSchema, EnumOptionSchema, AssetReferenceOptionSchema, ScalarOptionSchema, StructOptionSchema, VectorOptionSchema, PlayerReferenceOptionSchema, EffectOutputsSchema } from '@glitch/shared/effect-definition.ts';
import type { AudioHistory } from '@glitch/shared/audio-history.ts';
import type { WrapModeOptionSchema, WrapModeValue } from '@glitch/shared/effect-definition.ts';
import type { EffectStatus } from '@glitch/shared/effect-status.ts';
import type { VideoAssetReferenceOptionSchema } from './effect-definition.ts';
import type { Asset } from './types.ts';

// 画像の中間処理でフィルタリング・ブレンド可能なRGBA形式。
export type IntermediateTextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';

type RuntimeEffectOptionScalarValue<T extends EffectOptionsSchema[string], Mode extends InputMode> =
	T extends { canNode: true } ? (Mode extends 'shaderInput' ? ShaderInput : GPUTexture) :
	T extends ScalarOptionSchema ? number :
	T extends BooleanOptionSchema ? boolean :
	T extends ColorOptionSchema ? Readonly<[number, number, number, number]> :
	T extends VectorOptionSchema ? Readonly<[number, number]> :
	T extends BlendModeOptionSchema ? string :
	T extends FitModeOptionSchema ? 'stretch' | 'cover' | 'contain' :
	T extends WrapModeOptionSchema ? WrapModeValue<T> :
	T extends EnumOptionSchema ? T['options'][number]['value'] :
	T extends AssetReferenceOptionSchema ? GPUTexture | null :
	T extends VideoAssetReferenceOptionSchema ? Pick<Asset, 'id' | 'fileData'> | null :
	T extends PlayerReferenceOptionSchema ? { videoFrame: VideoFrame | null; audio: AudioHistory | null; } | null :
	T extends StructOptionSchema ? {
		[K in keyof T['fields']]: RuntimeEffectOptionValue<T['fields'][K], Mode>;
	} :
	never;

type RuntimeEffectOptionValue<T extends EffectOptionsSchema[string], Mode extends InputMode> = T extends unknown ?
	T extends ArrayOptionSchema ? RuntimeEffectOptionValue<T['item'], Mode>[] : RuntimeEffectOptionScalarValue<T, Mode> :
	never;

export type InputMode = 'texture' | 'shaderInput';

export type GetRuntimeEffectOptionsSchemaValues<T extends EffectOptionsSchema, Mode extends InputMode = 'texture'> = {
	[K in keyof T]: RuntimeEffectOptionValue<T[K], Mode>;
};

export type EffectInstance<Options extends EffectOptionsSchema = any, Outputs extends EffectOutputsSchema = any, Mode extends InputMode = InputMode> = {
	readonly cacheVersion?: number;
	/** パラメータ変更による非同期の準備を開始する。完了はreportStatusで通知する。 */
	prepare?: (params: GetRuntimeEffectOptionsSchemaValues<Options, Mode>) => void;
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
		params: GetRuntimeEffectOptionsSchemaValues<Options, Mode>;
	}) => void;
	dispose: () => void;
};

export type EffectImplementation<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'> = EffectDefinition, Options extends EffectOptionsSchema = Definition['paramDefs'], Mode extends InputMode = InputMode> = {
	/** 移行済みのエフェクトだけ、定数値と接続情報を保持した入力を受け取る。 */
	inputMode?: Mode;
	disableCache?: boolean;
	needsPreviousFrame?: boolean;
	/** 入力に合わせて出力サイズを決めるエフェクト用。未指定なら描画先の解像度を使う。 */
	getOutputResolution?: (params: GetRuntimeEffectOptionsSchemaValues<Options, Mode>, outputPort: Extract<keyof Definition['outputs'], string>) => { width: number; height: number };
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
		params: GetRuntimeEffectOptionsSchemaValues<Options, Mode>;
		fallbackTexture: GPUTexture;
	}) => EffectInstance<Options, Definition['outputs'], Mode>;
};

export function implementEffect<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'>, Mode extends InputMode = 'texture'>(def: EffectImplementation<Definition, Definition['paramDefs'], Mode>): EffectImplementation<Definition, Definition['paramDefs'], Mode> {
	return def;
}
