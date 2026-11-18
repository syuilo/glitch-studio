import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { StaticSettingValues } from '@gs/shared/static-setting.ts';

/** 一つの配置の寿命中に固定する。入力寸法はGPU実行前の解像度計画から渡せる。 */
export type EffectInstanceOptions = {
	device: GPUDevice;
	resolution: Resolution;
	enable32bitDataTextures: boolean;
	staticSettings: StaticSettingValues;
	getInputResolution: (parameterId: string) => Resolution | null;
};

export type EffectRenderRequest = {
	time: number; // 秒
	timeDelta: number; // ミリ秒
	commandEncoder: GPUCommandEncoder;
	/** 配置先のスコープで評価済みの値。省略したキーには定義の既定値を使う。 */
	params: Readonly<Record<string, unknown>>;
	requestedOutputIds: ReadonlySet<string>;
};

export interface EffectInstance {
	/** 出力が使う公開入力。省略時は全入力を使う。親は未使用の枝の描画履歴を進めない。 */
	getRequiredParameterIds?(outputId: string): ReadonlySet<string>;
	/** 定数や未接続の出力は固有寸法を持たない。 */
	getOutputResolution(outputId: string): Resolution | null;
	/** 結果は借用値。呼び出し側は次の描画・破棄より前に、この評価のコマンドをsubmitする。 */
	render(request: EffectRenderRequest): Promise<ReadonlyMap<string, UniformOrTexture>>;
	dispose(): void;
}
