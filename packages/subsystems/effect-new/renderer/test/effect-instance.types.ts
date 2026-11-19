import { createEffectInstance } from '../src/create-effect-instance.ts';
import { implementNativeEffect } from '../src/native-effect/implement-native-effect.ts';
import type { EffectEnvironment, EffectFrame, EffectInstanceOptions, EffectOutput } from '../src/effect-instance.ts';

// 【Native Effectの実装と利用側で出力をtextureに固定する】
// 登録時にuniformを返す実装を拒否し、利用側は出力種別の分岐なしでテクスチャを借用できる。
declare const uniform: Extract<EffectOutput, { kind: 'uniform' }>;
// @ts-expect-error Native Effectの出力ポートはtextureのみ
implementNativeEffect(() => ({ outputs: { output: uniform }, render() {}, dispose() {} }));

declare const options: EffectInstanceOptions;
declare const environment: EffectEnvironment;
declare const frame: EffectFrame;
const native = await createEffectInstance({ type: 'nativeEffect', id: 'fill' }, options, environment);
const texture: GPUTexture | undefined = native.outputs.output?.read(frame).texture;
