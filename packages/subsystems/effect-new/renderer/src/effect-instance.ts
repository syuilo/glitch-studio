import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { TextureValue, UniformValue } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { ExpressionEngine } from '@gs/shared/expression/expression-engine.ts';
import type { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-source.ts';
import type { NativeEffectDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

/** 1回の評価に1つ作成し、同じ配置の全ノードで共有する。submitは呼び出し側が所有する。 */
export type EffectFrame = {
	readonly commandEncoder: GPUCommandEncoder;
	/** timeとendTimeは秒、timeDeltaはミリ秒。 */
	readonly time: number;
	readonly endTime: number;
	readonly timeDelta: number;
	readonly isExport: boolean;
	readonly progress?: number;
	/** 長辺全体を1とする共通座標。 */
	readonly pointerPosition?: { x: number; y: number };
};

/** Native EffectとCustom Shader Effectの出力。寸法は配置の寿命中固定し、テクスチャは借用する。 */
export type EffectTextureOutput = { readonly kind: 'texture'; readonly resolution: Resolution; readonly read: (frame: EffectFrame) => TextureValue };

/** Custom Node Graph Effectは、公開入力を転送する経路でuniformも返す。 */
export type EffectOutput =
	| { readonly kind: 'uniform'; readonly read: (frame: EffectFrame) => UniformValue }
	| EffectTextureOutput;

export type EffectImageInput = EffectOutput & { readonly sampling: ShaderInputSampling };
export type EffectParameterInput = EffectImageInput
	| { readonly kind: 'value'; readonly read: (frame: EffectFrame) => unknown }
	| { readonly kind: 'array'; readonly elements: readonly EffectParameterInput[] }
	| { readonly kind: 'struct'; readonly fields: Readonly<Record<string, EffectParameterInput>> };

export type EffectInstanceOptions = {
	readonly gpu: { device: GPUDevice; defaultVertexShaderModule: GPUShaderModule; enable32bitDataTextures: boolean };
	readonly resolution: Resolution;
	readonly usedOutputPorts: ReadonlySet<string>;
	readonly inputs: Readonly<Record<string, EffectParameterInput>>;
	readonly staticSettings: StaticSettingValues;
};

export type EffectInstance<Output extends EffectOutput = EffectOutput> = {
	/** 使用するポートだけを公開する。配線されていないグラフ出力には値がない。 */
	readonly outputs: Readonly<Partial<Record<string, Output>>>;
	render(frame: EffectFrame): void;
	dispose(): void;
};

export type NativeEffectImplementation = (options: EffectInstanceOptions) => EffectInstance<EffectTextureOutput> | Promise<EffectInstance<EffectTextureOutput>>;

export type EffectEnvironment = {
	readonly catalog: EffectCatalog;
	readonly nativeImplementations: ReadonlyMap<string, NativeEffectImplementation>;
	readonly expressionEngine?: ExpressionEngine | null;
	readonly resolutionScale?: number;
	readonly getIntrinsicResolution?: (definition: NativeEffectDefinition, settings: StaticSettingValues) => Resolution | null;
	readonly resolveAudioSource?: (selection: unknown, frame: EffectFrame) => unknown;
};
