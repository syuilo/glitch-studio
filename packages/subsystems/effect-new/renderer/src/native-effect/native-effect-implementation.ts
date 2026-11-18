import type { EffectInstanceImplementation, EffectInstanceOptions } from '../effect-instance.ts';

/** 登録された実装を配置ごとに呼び、履歴・GPUリソースを個別に所有する。 */
export type NativeEffectImplementation = (options: EffectInstanceOptions) => EffectInstanceImplementation;
