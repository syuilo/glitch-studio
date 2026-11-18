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

type EffectParameterValues = Readonly<Record<string, unknown>>;

export type EffectFrameRequest<Params extends EffectParameterValues = EffectParameterValues> = {
	time: number; // 秒
	timeDelta: number; // ミリ秒
	/** 配置先のスコープで評価済みの値。省略したキーには定義の既定値を使う。 */
	params: Params;
	requestedOutputIds: ReadonlySet<string>;
};

export type EffectRenderRequest<Params extends EffectParameterValues = EffectParameterValues> = EffectFrameRequest<Params> & {
	commandEncoder: GPUCommandEncoder;
};

export type EffectPreparation = {
	/** この評価が返す定数と借用テクスチャ。画素の書き込みはrenderで初めて記録する。 */
	outputs: ReadonlyMap<string, UniformOrTexture>;
	/** 同期で準備が終わる場合は省略する。後続ノードの準備はこの完了を待つ必要がない。 */
	pending?: Promise<void> | null;
};

interface EffectInstancePorts {
	/** 出力が使う公開入力。省略時は全入力を使う。親は未使用の枝の描画履歴を進めない。 */
	getRequiredParameterIds?(outputId: string): ReadonlySet<string>;
	/** 定数や未接続の出力は固有寸法を持たない。 */
	getOutputResolution(outputId: string): Resolution | null;
}

/** 配置の実装。prepareは何度でも更新できる。履歴の更新はrenderで一度だけ行う。 */
export interface EffectInstanceImplementation extends EffectInstancePorts {
	prepare(request: EffectFrameRequest): EffectPreparation;
	// undefinedを指定すると、void型のコールバックにasync関数を渡せてしまうことを防げる。
	render(commandEncoder: GPUCommandEncoder): undefined;
	dispose(): void;
}

export interface EffectInstance extends EffectInstancePorts {
	prepare(request: EffectFrameRequest): void;
	/** 未準備・破棄済みではfalse。準備の失敗は元のエラーをthrowする。 */
	checkReady(): boolean;
	/** 待機中のフレームの差し替え、破棄、signalの中断ではfalseを返す。 */
	waitUntilReady(signal?: AbortSignal): Promise<boolean>;
	/** 結果は借用値。呼び出し側は次の描画・破棄より前に、この評価のコマンドをsubmitする。 */
	render(commandEncoder: GPUCommandEncoder): ReadonlyMap<string, UniformOrTexture>;
	dispose(): void;
}
