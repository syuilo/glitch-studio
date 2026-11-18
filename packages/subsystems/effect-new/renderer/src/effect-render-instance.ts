import type { ExpressionEngine } from '@gs/shared/expression/expression-engine.ts';
import type { UniformOrTexture } from '@gs/shared/gpu/uniform-or-texture.ts';
import type { ParameterEvaluationScope } from '@gs/shared/parameter/parameter-evaluation-scope.ts';
import type { Resolution } from '@gs/shared/resolution.ts';
import type { AudioInput } from '@gs/subsystems_audio_shared/audio-input.ts';

export type EffectRenderEnvironment = {
	readonly device: GPUDevice;
	readonly enable32bitDataTextures?: boolean;
};

export type EffectPlacementOptions = {
	readonly resolution: Resolution;
	/** グラフの出力寸法を描画前に計画するため、外部テクスチャの寸法を配置時に宣言する。 */
	readonly inputResolutions?: ReadonlyMap<string, Resolution | null>;
};

export type EffectRenderRequest = {
	readonly commandEncoder: GPUCommandEncoder;
	/** CPU値、または接続可能な入力のShaderInput。省略したポートには定義の既定値を使う。 */
	readonly parameters: ReadonlyMap<string, unknown>;
	readonly outputIds: ReadonlySet<string>;
	/** 公開時刻は秒。ParameterEvaluationScopeへ渡すときにミリ秒へ変換する。 */
	readonly time: number;
	readonly endTime?: number;
	readonly expressionEngine?: ExpressionEngine;
	readonly parameterScope?: ParameterEvaluationScope;
	/** 保存された音声取得元を今回の描画で借用する入力へ解決する。時刻の単位は秒。 */
	readonly resolveAudioSource?: (source: unknown, time: number) => AudioInput | null;
};

/** 配置ごとに生成する。複数ポートを一度に描き、テクスチャは元の所有者（外部入力または生成元の配置）から借用する。 */
export interface EffectRenderInstance {
	prepare(outputIds: ReadonlySet<string>): Promise<void>;
	render(request: EffectRenderRequest): ReadonlyMap<string, UniformOrTexture>;
	getOutputResolution(outputId: string): Resolution | null;
	/** グラフは要求出力から到達する入力を返せる。省略した実装は全入力を使用する。 */
	getRequiredParameterIds?(outputIds: ReadonlySet<string>): ReadonlySet<string>;
	resetRenderHistory(): void;
	destroy(): void;
}
