import type { EffectGpuContext, EffectInstance, EffectInstanceOptions } from '../effect-instance.ts';

/** 登録定義が同じでも、配置ごとに独立したインスタンスと描画履歴を生成する。 */
export type CreateNativeEffectInstance = (options: EffectInstanceOptions, gpu: EffectGpuContext) => EffectInstance | Promise<EffectInstance>;
