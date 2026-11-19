# Effect

Native Effect・Custom Node Graph Effect・Custom Shader Effect を同じ API で配置、描画する基盤。アプリへの組み込みに先立ち、独立した workspace パッケージとして利用できる。

| パッケージ | 責務 |
| --- | --- |
| `@gs/subsystems_effect-new_shared` | 保存形式 `EffectSource`、公開するパラメータと出力、定義の解決、編集・読み込み時の検証 |
| `@gs/subsystems_effect-new_renderer` | 配置の初期化、グラフの描画順と依存関係、Custom Shader Effect のコンパイルと実行 |
| `@gs/subsystems_effect-new_native-effects` | Native Effect の定義と実装。最初の登録は `fill`。UI は `definitions.ts`、描画側は `implementations.ts` から取得できる |

## 配置と描画

登録 ID の有効範囲はカタログの所有者が決める。パラメータと出力ポートには、表示名や WGSL の参照名から独立した固定 ID を使う。保存済み定義を編集・読み込みしたときは `validateEffectSource(source, catalog)` で参照・接続を検証する。未接続のノードを含めて、グラフ定義間の再帰とノード配線の循環を検出する。

```ts
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { nativeEffectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
import { nativeEffectImplementations } from '@gs/subsystems_effect-new_native-effects/implementations.ts';

const fill = await createEffectInstance({ type: 'nativeEffect', id: 'fill' }, {
	resolution: { width: 1920, height: 1080 },
	requestedOutputIds: ['output'],
	inputLayouts: { color: { kind: 'value' } },
}, {
	gpu: { device, defaultVertexShaderModule, enable32bitDataTextures: false },
	catalog: {
		getNativeEffectDefinition: id => nativeEffectDefinitions.get(id) ?? null,
		getCustomNodeGraphEffect: () => null,
		getCustomShaderEffect: () => null,
	},
	getNativeEffectImplementation: id => nativeEffectImplementations.get(id) ?? null,
});

const { source } = fill.outputs.output;
if (source.type === 'produced') {
	// Fill は配置の寿命中、初期化時に確保した同じテクスチャに描く。
	const output = source.read();
	const commandEncoder = device.createCommandEncoder();
	fill.render({ commandEncoder, time: 0, parameters: { color: [1, 0, 0, 0.5] } });
	// この encoder に、借用した output を使う合成や表示のコマンドも記録できる。
	device.queue.submit([commandEncoder.finish()]);
}
fill.dispose();
```

要求出力は配置の寿命中固定する。グラフの初期化では、外から要求されたポートを配線に沿って逆にたどり、入れ子の配置でも必要なポートを合流させてから描画順を決定する。フレームごとの評価では、この順序で各配置を一度ずつ描く。同じ登録定義を別ノードで使うときは、それぞれが独立したインスタンスを持つ。未接続の公開出力は結果から省き、その出力を参照する内部入力は自身の既定値を使う。

自動解像度を求めるためだけに参照する配置は、初期化時に出力寸法を取得して解放する。同じ出力の画素を読み取る配線もある場合は描画対象になり、そのフレームの履歴を一度だけ進める。

`instance.outputs[portId]` には、初期化時に確定した `layout` と `source` が入る。`layout` は `uniform`／`texture` の区分と、テクスチャなら計画済みの解像度を持つ。`render(frame): void` は描画計画を実行する。

- `source.type === 'parameter'` は公開入力への直結を表す。呼び出し側は `source.parameterId` で特定した入力の供給元をそのまま下流に接続する。親の `A.output` が子の公開入力と公開出力を経由して `B` に届く場合、初期化時に `B` の入力を `A.output` に配線する。フレーム間で入力の値やテクスチャが変わっても、同じ供給元を使う。
- `source.type === 'produced'` では `source.read()` がそのポートの借用値を返す。出力テクスチャを固定する Fill や Custom Shader Effect では初期化時にその参照を取得できる。描画によって値そのものを更新するポートは、そのフレームの生成処理の後に読む。

Fit・Wrap・Filter は実際に画像を読む接続に適用する。構成・解像度・配線・要求出力の変更では配置を作り直す。次の描画を始める前に、前回の出力を使うコマンドを submit する。

Custom Shader Effect は、全入力の `uniform`／`texture` 区分を初期化時に必要とする。その区分で一度だけパイプラインを生成し、初期化の Promise で WGSL の診断も返す。ユーザーの `main(position) -> Output` は定義した全メンバーを書ける。描画先には要求された出力だけを割り当てる。

リテラルと配線はグラフ自身が解決する。式・キーなどの値 Binding には、呼び出し側が `evaluateBinding` でその配置の評価環境を渡す。時刻は `EffectFrame.time`（秒）、ノードの解像度は初期化時に確定した値を使う。
