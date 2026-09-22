# 生成するシェーダー入力

`implementEffect<typeof definition, 'shaderInput'>` と `inputMode: 'shaderInput'` を指定したエフェクトでは、`canNode` パラメータを `ShaderInput` として受け取る。現在の導入先はcolorMixとsymbols。未移行のエフェクトは従来どおりGPUTextureを受け取る。

- `uniform` は画面全体で同じ値。リテラルだけでなくexpressionやautomationの評価値も含む。f32のuniformへ書き込み、1×1テクスチャを作らない。`enable32bitDataTextures` は保存するテクスチャの精度設定なので、このuniformを16bitへ丸めない。
- `texture` は接続元の出力と、その入力接続のfit/wrap設定を持つ。省略時は `cover` / `repeatMirrored`。入力テクスチャの保存形式は変更しない。
- 色の定数はレンダラーで一度だけpremultiplyする。画像テクスチャは既に乗算済みとして読み、そのまま返す。スカラー・ベクトル・汎用データには乗算しない。未接続入力は0（色なら透明）のuniformとする。

`generateShaderInputs()` は宣言、`read_<入力名>(position)` 関数、binding配置を同時に生成する。引数は中央原点、+Yが上の[-1, 1]座標。スカラーはf32、ベクトルはvec2f、色・汎用データはvec4fを返す。入力名はWGSL関数名の一部になるため固定の識別子を使う。

`createShaderInputBindings()` は生成した配置に合わせてuniformとbind groupを管理する。`update()`にはそのpassの実際の出力サイズを渡す。入力ごとのサイズからfit倍率を求め、値・fitの変更はuniform、wrap・テクスチャの変更はbindingへ反映する。pipelineの切替は入力種別が変わった場合に行う。colorMixでは実際に使う構成だけ作り、最大8構成を保持する。bufferはエフェクトのdisposeで全構成分を破棄する。

fitは座標変換だけを行い、containの余白にもwrapを適用する。clampは端を伸ばし、repeatは繰り返し、repeatMirroredは鏡像で繰り返す。transparentはclamp samplerに透明な隣接画素との補間分を掛ける。定数入力にはfit/wrapを適用しない。参照位置の変換だけを共通化し、ベクトルの成分変換やエフェクト固有の幾何計算は行わない。

通常はimplicit samplingを使う。生成関数は分岐の外でtextureSampleを呼ぶが、呼び出し側にもfragmentのuniformな制御フローが必要。computeや画素ごとに異なる分岐から呼ぶ場合は生成時に `level0` を指定する。履歴の厳密な整数画素アクセスは、このAPIへ置き換えない。

## 検証

`pnpm test` でCPU側の接続解決・リソース更新・キャッシュを検証する。GPUテストは `CHROME_PATH` を設定すると同じコマンドで実行される。未設定時はGPUテストだけスキップする。

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test packages/renderer/test/shader-inputs*.test.mjs
```

GPUテストはheadless Chromeで実際のcolorMixと生成関数を実行し、全入力構成、異なるアスペクト比、fit/wrap、乗算済みアルファ、16bitデータと対応GPU上での32bitデータを画素比較する。
