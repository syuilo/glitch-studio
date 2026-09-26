import type { AudioHistory } from '../audio-history.ts';
import type { ParameterDefinition } from '../parameter.ts';
import type { DataType } from '../data-type.ts';
import type { ShaderInput } from '../shader-input.ts';
import type { Asset, FitMode, IntermediateTextureFormat, WrapMode } from '../types.ts';
import type { EffectOutputDefinitions, EffectDefinition } from './effect-definition.ts';
import type { EffectStatus } from './effect-status.ts';

// データの構造とパラメータ固有の設定を並行してたどる。
// 子の設定はdataTypeやUIを持たないが、canNodeの規約は最上位と同じ。
type RuntimeEffectOptionValue<D extends DataType, S> =
	S extends { canNode: true } ? ShaderInput :
	D extends { kind: 'scalar' } ? number :
	D extends { kind: 'bool' } ? boolean :
	D extends { kind: 'color' } ? Readonly<[number, number, number, number]> :
	D extends { kind: 'vector' } ? Readonly<[number, number]> :
	D extends { kind: 'blendMode' } ? string :
	D extends { kind: 'fitMode' } ? FitMode :
	D extends { kind: 'wrapMode' } ? WrapMode :
	D extends { kind: 'enum'; options: readonly string[] } ? D['options'][number] :
	D extends { kind: 'assetReference' } ? GPUTexture | null :
	D extends { kind: 'videoAssetReference' } ? Pick<Asset, 'id' | 'fileData'> | null :
	D extends { kind: 'playerReference' } ? { videoFrame: VideoFrame | null; audio: AudioHistory | null; } | null :
	D extends { kind: 'struct'; fields: infer F extends Record<string, DataType> }
		? S extends { fields: infer Settings }
			? { [K in keyof F]: RuntimeEffectOptionValue<F[K], K extends keyof Settings ? Settings[K] : never> }
			: never :
		D extends { kind: 'array'; elementType: infer E extends DataType }
			? S extends { element: infer Settings } ? RuntimeEffectOptionValue<E, Settings>[] : never :
			never;

// パラメータ定義を元にresolveされた実行時に実際に渡される値
type GetRuntimeEffectOptionsSchemaValues<T extends Record<string, ParameterDefinition>> = {
	[K in keyof T]: RuntimeEffectOptionValue<T[K]['dataType'], T[K]>;
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

export type EffectImplementation<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs'> = EffectDefinition, Options extends Record<string, ParameterDefinition> = Definition['paramDefs']> = {
	disableCache?: boolean;
	needsPreviousFrame?: boolean;
	/** 入力に合わせて出力サイズを決めるエフェクト用。未指定またはundefinedを返す場合は描画先の解像度を使う。 */
	getOutputResolution?: (params: GetRuntimeEffectOptionsSchemaValues<Options>, outputPort: Extract<keyof Definition['outputDefs'], string>) => { width: number; height: number } | undefined;
	outputTextureFactories: {
		// canLazyAllocation=trueのポートだけ遅延確保する。それ以外はノード追加時に確保する。
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
	}) => EffectInstance<Options, Definition['outputDefs']>;
};

export function implementEffect<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputDefs'>>(def: EffectImplementation<Definition, Definition['paramDefs']>): EffectImplementation<Definition, Definition['paramDefs']> {
	return def;
}
