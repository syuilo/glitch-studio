# Effect

`shared` は Effect の公開入出力、参照、定義の解決と静的検証を担当する。`renderer` は WebGPU デバイス上に配置ごとの描画インスタンスを作る。両パッケージはプロジェクトや Timeline の状態を必要としない。

## Effect を配置する

`EffectCatalog` に、ID で引ける Custom Node Graph Effect と Custom Shader Effect の定義を渡す。Native Effect の定義は組み込みで、サンプルの ID は `solidColor`。ID の名前空間は種別ごとに独立する。`getDefinition(source)` で共通の入出力を取得できる。

呼び出し側は定義の読み込み時と、その定義や参照先の編集時に `catalog.validate(source)` を呼び、子孫の参照・配線まで検証する。同じ検証済みの定義から複数の描画インスタンスを生成できる。配置寸法が GPU の上限に収まるかは、各インスタンスの生成時に検査する。

```ts
import { EffectCatalog } from '@gs/subsystems_effect-new_shared/effect-catalog.ts';
import { createEffectRenderInstance } from '@gs/subsystems_effect-new_renderer/create-effect-render-instance.ts';

const catalog = new EffectCatalog();
const source = { type: 'nativeEffect', id: 'solidColor' } as const;
catalog.validate(source);
const instance = createEffectRenderInstance(catalog, source, { device }, { resolution: { width: 1920, height: 1080 } });
const outputIds = new Set(['color']);
try {
	await instance.prepare(outputIds);
	const commandEncoder = device.createCommandEncoder();
	const outputs = instance.render({
		commandEncoder, outputIds, time: 0,
		parameters: new Map([['color', [2, 0, 0, 0.5]]]),
	});
	// outputs.get('color') のテクスチャを読む後続パスもここで記録できる。
	device.queue.submit([commandEncoder.finish()]);
} finally {
	instance.destroy();
}
```

定義・接続・配置寸法はインスタンスの寿命中は固定する。編集時は新しい定義で配置を生成する。毎回変化する時刻（秒）と引数は `render` に渡す。取得したテクスチャは借用値で、同じ配置を再描画すると内容が更新される。その配置のコマンドは次の描画または破棄までに submit する。グラフが外部入力をそのまま返した場合、テクスチャの所有権は入力元にある。

## Custom Node Graph Effect

- 各ノードは `effect` に `EffectReference`、`params` に引数を持つ。引数には値・式・キーなどの binding、グラフの公開パラメータ、別ノードの出力を指定できる。式エンジンは呼び出し側が渡し、`PUBLIC(id)` はそのグラフの公開 CPU 値を読む。
- グラフの `outputs` は公開ポート ID と供給元の対応を持つ。要求ポートをまとめて評価し、同じ配置へ複数の接続があってもその配置の描画は1回。別の配置には独立したインスタンスを割り当てる。
- ノードの基準寸法は親から継承し、`node.resolution` で個別に指定できる。外部テクスチャは配置時の `inputResolutions` で寸法を宣言する。`getOutputResolution(id)` はポートごとの供給元をたどり、未接続や均一値など寸法のない出力には `null` を返す。
- グラフ本体を所有する呼び出し元は `{ type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect }` を直接配置できる。グラフ内のノードは定義を ID で参照する。

## Custom Shader Effect

WGSL の `main(position: vec2f) -> Output` を定義する。`inputNames` と `outputNames` は安定したポート ID と WGSL 識別子の対応で、入力は `read_<name>(position)`、出力は `Output` の各フィールドから受け渡す。位置の原点は中央、右が +X、上が +Y で、描画領域の長辺全体が 1。`get_resolution()`・`get_pixel_size()`・`get_time()` を使用できる。

色出力は乗算済み linear sRGB の `rgba16float`。スカラー・ベクトルなどのデータ出力は既定で 16 bit float を使う。`enable32bitDataTextures` を指定して 32 bit テクスチャをフィルタリングする場合は、デバイスの `float32-filterable` 機能を有効にする。

3種類を組み合わせた実行例は [WebGPU テストのグラフ定義](renderer/test/fixtures/render-nested-effects.ts) にある。GPU テストは環境変数 `CHROME_PATH` に Chrome の実行ファイルを指定して実行する。
