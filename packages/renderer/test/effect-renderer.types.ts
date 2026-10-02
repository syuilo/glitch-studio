import { EffectRenderer } from '../src/effect-renderer.ts';
import definition from '../../shared/src/effect/fx/testStructArray/_def_.ts';
import implementation from '../../shared/src/effect/fx/testStructArray/_impl_.ts';
import type gradientDefinition from '../../shared/src/effect/fx/gradient/_def_.ts';
import type { EffectOutputDefinitions } from '../../shared/src/effect/effect-definition.ts';
import type { EffectGpuContext, EffectOutputDataMap, RuntimeEffectParameters } from '../../shared/src/effect/effect-implementation.ts';

declare const device: GPUDevice;
declare const defaultVertexShaderModule: GPUShaderModule;
declare const fallbackTexture: GPUTexture;
declare const params: RuntimeEffectParameters<typeof definition.paramDefs>;

// 【Canvasを持たないGPU環境でエフェクトを実行できる】
// 出力テクスチャだけを扱う呼び出し元に、表示先のCanvasを要求しない契約を保つ。
const wgpu: EffectGpuContext = { device, defaultVertexShaderModule, enable32bitDataTextures: false, intermediateTextureFormat: 'rgba8unorm' };

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

// 【遅延出力は存在を確認してから参照する】
// 非遅延のscalarは必ず確保される一方、未使用のvectorは存在しない。
// エフェクトの実装で未確保のテクスチャを参照する誤りを型で検出する。
function requiresPresenceChecksForLazyOutputs(outputs: EffectOutputDataMap<typeof gradientDefinition.outputDefs>) {
	outputs.scalar.texture.createView();
	// @ts-expect-error 遅延出力は未確保の可能性がある。
	outputs.vector.texture.createView();
	const vectorOutput = outputs.vector;
	if (vectorOutput != null) vectorOutput.texture.createView();
}

// 【遅延確保を明示的に無効にした出力は必須として扱う】
// canLazyAllocationの省略時だけでなく、falseを指定した出力も存在確認なしで利用できる。
function keepsEagerOutputsRequired(outputs: EffectOutputDataMap<{
	output: { dataType: { kind: 'color' }; canLazyAllocation: false };
}>) {
	outputs.output.texture.createView();
}

// 【定義の型を広げても遅延出力の存在を仮定しない】
// 複数のエフェクトを共通の型で扱う処理では、canLazyAllocationがbooleanまで広がる。
// 個別のtrueを型から判別できなくても、未確保の可能性を消してはいけない。
function requiresPresenceChecksForUnknownAllocation(outputs: EffectOutputDataMap<EffectOutputDefinitions>) {
	// @ts-expect-error 共通の出力定義では、常に確保されるポートかどうかは分からない。
	outputs.output.texture.createView();
	const output = outputs.output;
	if (output != null) output.texture.createView();
}

void requiresPresenceChecksForLazyOutputs;
void keepsEagerOutputsRequired;
void requiresPresenceChecksForUnknownAllocation;
