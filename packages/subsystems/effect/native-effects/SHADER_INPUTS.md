# 生成するシェーダー入力

Native Effectの `canNode: true` パラメータは `init()` の `inputs` から `ShaderInput` として受け取る。構造体・配列内の末端にも同じ規約を適用する。配列は `elements`、構造体は `fields` を持つ。 [Effectの入力型](../renderer/src/effect-instance.ts)

- `uniform` は画面全体で同じ値。リテラルだけでなく式やAutomation Graphの評価値も含む。f32のuniformへ書き込み、1×1テクスチャを作らない。`enable32bitDataTextures` はテクスチャの保存精度を指定する。
- `texture` は接続元の出力とその `resolution` を借用する。Fit／Wrap／Filterは受け取り側のBindingから `sampling` へ渡し、配置計画で `cover` / `repeatMirrored` / `linear` の既定値を補う。入力テクスチャの保存形式は維持する。
- 色の定数はレンダラーで一度だけpremultiplyする。画像テクスチャも乗算済みの色として読む。スカラー・ベクトル・汎用データは成分をそのまま読む。未接続の入力はパラメータの既定値を使う。

`generateShaderInputs()` は宣言、`read_<入力名>(position)` 関数、binding配置を同時に生成する。引数は中央原点、+Yが上の[-1, 1]座標。スカラーはf32、ベクトルはvec2f、色・汎用データはvec4fを返す。入力名はWGSLの識別子として有効な固定名を使う。 [共通の入力生成](../../../shared/src/gpu/shader-input.ts)

## 初期化と描画

配線、入力種別、配列の形、入力寸法と接続のサンプリングは配置の生成時に決まる。変更があれば配置を再生成する。描画時にはgetterからフレームごとの値や同じ寸法の借用テクスチャを読む。

入力で結果が決まる全画面の1パス描画は `createFullscreenEffect()` を使える。エフェクト固有のuniform等を `internalLayouts` のgroupに置き、その後ろに生成入力のgroupを追加する。独自のパスでは `createNativeEffectInputBindings()` や `createFixedInputBindings()` にパスの実際の出力寸法を渡し、描画時に `getBindGroup()` を呼ぶ。 [全画面描画](src/fullscreen-effect.ts) · [入力の束縛](src/shader-input.ts)

低レベルAPIでは、初期化時に `generateShaderInputs()` と `createShaderInputBindings()` でWGSLとGPUリソースを準備する。`bindFixedInputs()` で描画時に使うbind groupのgetterを作る。getterは値とサンプリング情報を反映し、テクスチャの組み合わせが変わったときに対応するbind groupを返す。エフェクトの `dispose()` から入力バッファを解放し、借用テクスチャの寿命は所有者に任せる。

## 配列入力

schemaに `{ images: { array: 'color' } }` と指定すると、`ShaderInput` を要素に持つ配列を渡せる。scalar/vector/color/anyの配列と単一入力を混在できる。構造体配列は `elements` から各要素の `fields` をたどって必要なフィールドを取り出す。

次の例では `images` の各要素と `selector` に `canNode: true` を指定する。

```ts
init(context) {
	return createFullscreenEffect(context, {
		code,
		schema: { images: { array: 'color' }, selector: 'scalar' },
		inputs: { images: context.inputs.images, selector: context.inputs.selector },
		sampling: 'level0',
	});
}
```

```wgsl
// indexの決め方はエフェクトの仕様。count_imagesは配列長を表すu32定数。
let index = u32(max(0.0, floor(read_selector(position))));
let color = read_images(index, position);
```

`read_<配列名>(index: u32, position: vec2f)` はswitchで該当要素だけを参照する。各要素は独立したuniformまたはtextureで、テクスチャのFit／Wrap／Filterも要素ごとに適用する。空配列・範囲外indexは型に応じた0（色なら透明）を返す。画素ごとに異なる要素を選べるよう、配列要素のテクスチャはLOD 0を使う。`sampling: 'level0'` と `scalarGradients: true` を指定すると、スカラー配列には `readGradient_<配列名>(index, position, calculate)` も生成し、範囲外はvec3f(0)を返す。

`samplingOverrides.referenceResolutions` でFitの基準寸法を入力ごとに指定できる。配列入力に単一の寸法を渡すと全要素で共有し、寸法の配列を渡すと対応する要素へ適用する。未指定の入力・要素はパスの出力寸法を基準にする。配置中に描画領域が変わる場合は、束縛した寸法オブジェクトの `width` と `height` を描画前に更新する。 [Radial Splitの実装例](src/fx/radialSplit/_impl_.ts)

テクスチャ要素ごとにテクスチャとサンプラーの枠を1つずつ使う。uniform要素はuniform bufferに入る。入力groupだけでテクスチャ数・サンプラー数・uniformサイズ・binding数の上限を超える場合は、リソース作成前にエラーとする。内部groupを含む合計は、GPUがpipeline作成時に検証する。

## サンプリング

Fitは座標を変換し、containの余白も接続のWrapに従う。clampは端を伸ばし、repeatは繰り返し、repeatMirroredは鏡像で繰り返す。transparentではlinearなら透明な隣接画素と補間し、nearestならUVの[0, 1)外を0にする。定数入力は位置によらず同じ値を返す。ベクトルの成分変換やエフェクト固有の幾何計算は各Native Effectが担当する。

入力ポートのFilterはlinear／nearestから選ぶ。設定を変更すると配置を作り直す。通常のfragmentではimplicit samplingを使う。computeや画素ごとに異なる分岐から呼ぶ場合は生成時に `level0` を選ぶ。

## 特殊な入力処理

厳密な整数画素参照や専用テクスチャへの変換が必要なら、texture入力の `GPUTexture` を直接扱える。uniformの場合もエフェクトの仕様に応じて処理する。素材・Playerなどの静的設定は `resources` から、接続に対応しない通常パラメータは評価済みの `value` から受け取る。

Custom Node Graph EffectのInからOutへの直結やBypassは、対応するテクスチャを借用して渡す。借用するテクスチャの寿命は元の所有者が管理する。 [Effectの出力と配置](../README.md)

## 検証

リポジトリルートで実行する。CPUテストは配列の形、Fitの基準寸法、サンプリング設定、binding上限を確認する。GPUテストには `CHROME_PATH` を指定する。生成された入力関数の描画や、Image Stackの領域ごとのサンプリングを実際のWebGPUで確認できる。

```powershell
node --test packages/glitch-studio/renderer/test/shader-input-arrays.test.mjs packages/glitch-studio/renderer/test/shader-inputs.test.mjs
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test packages/glitch-studio/renderer/test/shader-inputs.gpu.test.mjs packages/subsystems/effect/native-effects/test/image-stack.gpu.test.mjs
```
