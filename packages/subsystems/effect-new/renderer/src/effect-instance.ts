import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';

/** 配置の寿命中に変わらない表現。uniformには固有の画素寸法がない。 */
export type EffectOutputLayout =
	| { readonly kind: 'uniform' }
	| { readonly kind: 'texture'; readonly resolution: Readonly<Resolution> };

/** valueはCPUで評価したパラメータ。接続可能な空間入力はuniformかtextureで渡す。 */
export type EffectInputLayout = { readonly kind: 'value' } | EffectOutputLayout;

export type EffectInstanceOptions = {
	readonly requestedOutputIds: readonly string[];
	readonly inputLayouts: Readonly<Record<string, EffectInputLayout>>;
	readonly resolution: Readonly<Resolution>;
	readonly staticSettings?: StaticSettingValues;
};

export type EffectGpuContext = {
	readonly device: GPUDevice;
	readonly defaultVertexShaderModule: GPUShaderModule;
	readonly enable32bitDataTextures: boolean;
};

export type EffectFrame = {
	readonly commandEncoder: GPUCommandEncoder;
	/** 呼び出し元の時計による秒単位の時刻。 */
	readonly time: number;
	/** canNodeの入力には読み取り設定付きのShaderInputを、その他には評価済みの値を渡す。 */
	readonly parameters: Readonly<Record<string, unknown>>;
};

/** 出力は借用値。次のrender()が同じuniformやテクスチャを更新する前に、呼び出し側で前回分をsubmitする。 */
export type EffectInstance = {
	readonly outputLayouts: Readonly<Record<string, EffectOutputLayout>>;
	render(frame: EffectFrame): Readonly<Record<string, UniformOrTexture>>;
	dispose(): void;
};
