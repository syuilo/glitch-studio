import type { BlendModeOptionSchema, FitModeOptionSchema, BooleanOptionSchema, ColorOptionSchema, EffectDefinition, EffectOptionsSchema, EnumOptionSchema, ImageOptionSchema, NodeOptionSchema, NumberOptionSchema, RangeOptionSchema, SeedOptionSchema, SignalOptionSchema, VectorOptionSchema, PlayerOptionSchema, EffectOutputsSchema } from '@glitch/shared/fx-definition.ts';
import type { AudioHistory } from '@glitch/shared/audio-history.ts';
import type { EffectStatus } from '@glitch/shared/effect-status.ts';

// 画像の中間処理でフィルタリング・ブレンド可能なRGBA形式。
export type IntermediateTextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgba16float';

type RuntimeEffectOptionValue<T extends EffectOptionsSchema[string]> =
	T extends { canNode: true } ? GPUTexture :
	T extends NumberOptionSchema ? number :
	T extends BooleanOptionSchema ? boolean :
	T extends ColorOptionSchema ? Readonly<[number, number, number, number]> :
	T extends VectorOptionSchema ? Readonly<[number, number]> :
	T extends SignalOptionSchema ? Readonly<[boolean, boolean, boolean]> :
	T extends BlendModeOptionSchema ? string :
	T extends FitModeOptionSchema ? 'stretch' | 'cover' | 'contain' :
	T extends SeedOptionSchema ? number :
	T extends EnumOptionSchema ? T['options'][number]['value'] :
	T extends RangeOptionSchema ? number :
	T extends ImageOptionSchema ? GPUTexture | null :
	T extends PlayerOptionSchema ? { videoFrame: VideoFrame | null; audio: AudioHistory | null; } | null :
	T extends NodeOptionSchema ? GPUTexture | null :
	never;

export type GetRuntimeEffectOptionsSchemaValues<T extends EffectOptionsSchema> = {
	[K in keyof T]: RuntimeEffectOptionValue<T[K]>;
};

export type EffectInstance<Options extends EffectOptionsSchema = any, Outputs extends EffectOutputsSchema = any> = {
	readonly cacheVersion?: number;
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
		commandEncoder: GPUCommandEncoder;
		createPassEncoderFor: (commandEncoder: GPUCommandEncoder, view: GPUTextureView) => GPURenderPassEncoder;
		createPassEncoder: (commandEncoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor) => GPURenderPassEncoder;
		createComputePassEncoder: (commandEncoder: GPUCommandEncoder, descriptor?: GPUComputePassDescriptor) => GPUComputePassEncoder;
		params: GetRuntimeEffectOptionsSchemaValues<Options>;
	}) => void;
	dispose: () => void;
};

export type EffectImplementation<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'> = EffectDefinition, Options extends EffectOptionsSchema = Definition['paramDefs']> = {
	disableCache?: boolean;
	needsPreviousFrame?: boolean;
	textureRequirements?: Partial<Record<keyof Options, {
		mipmaps?: boolean;
	}>>;
	getOut: (args: {
		resolution: { width: number; height: number; },
		wgpu: {
			device: GPUDevice;
			enableFloat32Filtering: boolean;
			intermediateTextureFormat: IntermediateTextureFormat;
		};
	}) => {
		[K in keyof Definition['outputs']]: GPUTexture
	};
	shader?: string;
	init: (args: {
		reportStatus: (status: EffectStatus) => void;
		resolution: { width: number; height: number; },
		wgpu: {
			device: GPUDevice;
			context: GPUCanvasContext;
			defaultVertexShaderModule: GPUShaderModule;
			enableFloat32Filtering: boolean;
			intermediateTextureFormat: IntermediateTextureFormat;
		};
		params: GetRuntimeEffectOptionsSchemaValues<Options>;
		fallbackTexture: GPUTexture;
	}) => EffectInstance<Options, Definition['outputs']>;
};

export function implementEffect<Definition extends Pick<EffectDefinition, 'paramDefs' | 'outputs'>>(def: EffectImplementation<Definition>): EffectImplementation<Definition> {
	return def;
}
