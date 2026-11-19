import type { ShaderInputSampling } from '@gs/shared/gpu/shader-input.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';
import type { ParameterDefaultValue } from '@gs/shared/parameter/parameter-definition.ts';
import type { DataType } from '@gs/shared/data-type/data-type.ts';
import type { EffectParameterDefinition } from '@gs/subsystems_effect-new_shared/effect-definition.ts';

/** 種別と寸法は配置の寿命中固定する。値・借用テクスチャはgetterでフレームごとの内容を渡せる。 */
export type EffectImageInput =
	| { readonly kind: 'uniform'; readonly value: readonly number[] }
	| { readonly kind: 'texture'; readonly resolution: Resolution; readonly texture: GPUTexture; readonly sampling?: ShaderInputSampling };

export type EffectParameterInput =
	| EffectImageInput
	| { readonly kind: 'value'; readonly value: unknown }
	| { readonly kind: 'array'; readonly elements: readonly EffectParameterInput[] }
	| { readonly kind: 'struct'; readonly fields: Readonly<Record<string, EffectParameterInput>> };

export interface EffectRenderContext {
	readonly commandEncoder: GPUCommandEncoder;
	readonly time: number;
	readonly timeDelta: number;
}

export interface EffectRenderOperation {
	render(context: EffectRenderContext): void;
	dispose(): void;
}

export interface EffectInstance extends EffectRenderOperation {
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
	} : { readonly kind: 'value'; readonly value: D extends { kind: 'audioSource' } ? unknown : ParameterDefaultValue<D>['value'] };

export interface EffectInitContext<Inputs = Readonly<Record<string, EffectParameterInput>>> extends EffectGpuContext {
	readonly resolution: Resolution;
	readonly inputs: Inputs;
	readonly staticSettings: StaticSettingValues;
	/** 使用する出力だけを初期化時に確保する。テクスチャの寿命はレンダラーが管理する。 */
	readonly outputTextures: ReadonlyMap<string, GPUTexture>;
}

export interface NativeEffectImplementation<Params extends Readonly<Record<string, EffectParameterDefinition>> = Readonly<Record<string, EffectParameterDefinition>>> {
	/** computeなど、標準の描画用テクスチャ以外を必要とする実装が指定する。 */
	createOutputTexture?(id: string, resolution: Resolution, gpu: EffectGpuContext): GPUTexture;
	init(context: EffectInitContext<string extends keyof Params ? Readonly<Record<string, EffectParameterInput>>
		: { readonly [Key in keyof Params]: NativeEffectInput<Params[Key]['dataType'], Params[Key]> }>): EffectRenderOperation | Promise<EffectRenderOperation>;
}
