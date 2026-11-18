# Effect

Native Effect、Custom Shader Effect、Custom Node Graph Effect を同じ公開入出力と描画手順で利用するための subsystem。

| パッケージ | 責務 |
| --- | --- |
| `shared` | 保存用の `EffectSource`、公開入出力の `EffectDefinition`、登録定義の解決、編集時の配線検証 |
| `renderer` | 配置ごとのインスタンス生成、Custom Shader Effect のコンパイル、Custom Node Graph Effect の解像度計画と同期描画 |
| `native-effects` | 個々の Native Effect と、定義・生成関数のカタログ。現在は `fill` を収録 |

## 利用例

```ts
import { validateEffectSource } from '@gs/subsystems_effect-new_shared/validate-effect-source.ts';
import { createEffectInstance } from '@gs/subsystems_effect-new_renderer/create-effect-instance.ts';
import { nativeEffectDefinitions } from '@gs/subsystems_effect-new_native-effects/definitions.ts';
import { nativeEffectImplementations } from '@gs/subsystems_effect-new_native-effects/implementations.ts';

const catalog = {
	nativeEffects: nativeEffectDefinitions,
	nativeEffectImplementations,
	customNodeGraphEffects: new Map(),
	customShaderEffects: new Map(),
};
const source = { type: 'nativeEffect', id: 'fill' } as const;
validateEffectSource(source, catalog);
const instance = await createEffectInstance(source, { device, resolution: { width: 640, height: 360 }, inputKinds: {} }, catalog);
try {
	const commandEncoder = device.createCommandEncoder();
	const outputs = instance.render({
		commandEncoder, requestedOutputIds: new Set(['output']),
		params: { color: [1, 0, 0, 0.5] }, time: 0, timeDelta: 0,
	});
	// outputs.get('output') を読む後段のコマンドも、この encoder に記録できる。
	device.queue.submit([commandEncoder.finish()]);
} finally {
	instance.dispose();
}
```

登録用の ID は種類ごとに解決する。インライン定義は配置が所有する。公開パラメータと出力ポートは、どちらの指定方式でも固定 ID で参照する。編集・読み込み時に `validateEffectSource` を呼び、ノードの配線と登録定義間の参照を検証する。

## 描画

`createEffectInstance` に、ノード接続を受け付ける各公開入力の種類を `inputKinds` で渡す。例えば `{ image: 'texture', gain: 'uniform' }` と指定すると、その配置では毎フレーム画像をテクスチャ、ゲインを定数として受け取る。定数値、テクスチャの実体、サンプリング設定はフレームごとに変えられる。配列や構造体は評価済みの値と同じ形で各要素・フィールドの種類を指定する。CPU値だけのパラメータやフィールドは省略でき、配列内のCPU値には `null` を使う。

動画素材は最初のフレームを取得する前から `texture` として準備できる。素材を供給する側が、サンプルのない時刻には共有の透明テクスチャを、取得できた時刻には動画のテクスチャを渡す。配線の編集で入力の種類や接続可能な配列の要素数が変わったときは、その配置を作り直す。

`createEffectInstance` は、その配置と子のGPU準備が終わると解決する。WGSLのコンパイル失敗はここで通知する。フレームごとの `render` は同期的に呼べる。全公開パラメータの評価済みの値と、今回使用する出力ポートをまとめて渡す。時刻は秒、経過時間はミリ秒。同じ子の異なる出力を複数箇所で使っても、そのフレームの描画は1回だけ行う。

出力は定数または借用テクスチャ。初回描画前から `getOutputKind(id)` で出力ポートの種類、`getOutputResolution(id)` で固有の寸法を取得できる。未接続の公開出力はどちらも `null` を返し、描画結果から省く。呼び出し側は結果を使うコマンドを submit してから同じ配置を再描画・破棄する。GPUの完了待ちは不要。

Custom Node Graph Effect の配置はリテラル・公開入力・他ノードの出力を Binding として持つ。配列・構造体の末端でも同じ方式で接続できる。各子の入力の種類は配線から決まり、入れ子のグラフでも上流の出力ポートから下流の配置へ順に伝わる。公開入力を経由する画像は借用したまま渡し、画像を読む接続で Fit / Wrap / Filter を適用する。式・キーの評価と既存の Timeline・エディタへの接続は今後の移行範囲。

Custom Shader Effect は配置の入力の種類に合わせて初期化時に pipeline を生成する。テクスチャ入力にだけテクスチャとサンプラーの binding を割り当て、定数入力は uniform buffer から読む。色出力は premultiplied linear sRGB の `rgba16float`、データ出力は指定精度の float テクスチャとなる。32bit のデータ出力をサンプリングするときは、呼び出し側で `float32-filterable` を有効にした device を渡す。
