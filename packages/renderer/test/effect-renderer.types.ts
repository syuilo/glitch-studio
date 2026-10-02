import { EffectRenderer } from '../src/effect-renderer.ts';
import definition from '../../shared/src/effect/fx/testStructArray/_def_.ts';
import implementation from '../../shared/src/effect/fx/testStructArray/_impl_.ts';
import type { EffectGpuContext, RuntimeEffectParameters } from '../../shared/src/effect/effect-implementation.ts';

declare const wgpu: EffectGpuContext;
declare const fallbackTexture: GPUTexture;
declare const params: RuntimeEffectParameters<typeof definition.paramDefs>;

// 【エフェクトの定義に従う入力・出力だけを単体レンダラーへ渡せる】
// Visual Module由来の型を使わず、既存実装のネストした実行時パラメータ型を再利用する。
const renderer = new EffectRenderer({ definition, implementation, wgpu, fallbackTexture, resolution: { width: 16, height: 9 } });
renderer.prepare(params);
renderer.getOutputTexture('output');
renderer.setUsedOutputPorts(new Set(['output', 'output2']));

// @ts-expect-error エフェクトが定義していない出力名は受け付けない。
renderer.getOutputTexture('unknown');
// @ts-expect-error 必要出力の集合も、そのエフェクトが定義したポート名に限定する。
renderer.setUsedOutputPorts(new Set(['unknown']));
// @ts-expect-error 解決済みパラメータを渡す。パラメータの集合を省略できない。
renderer.prepare({});
