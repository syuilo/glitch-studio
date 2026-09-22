# 生成するシェーダー入力

`implementEffect<typeof definition, 'shaderInput'>` と `inputMode: 'shaderInput'` を指定したエフェクトでは、`canNode` パラメータを `ShaderInput` として受け取る。未移行のエフェクトは従来どおりGPUTextureを受け取る。

現在の導入先:

- 合成: colorMix、colorBlend、dataMix、dataBlend
- データ生成・演算: composeVector、remap、multiply、rgbTo、snoise、gradient
- 画像加工: symbols、channelShift、chromaticAberration、colorBlocks、lcd、rainDropsOnWindow1、rainDropsOnWindow2、vectorDisplacement

移行済みのエフェクトでは、入力のfit/wrapは接続設定に統一する。従来の独立したfitModeA/B/Amountやwrapパラメータは削除している。未接続の定数は位置によらず同じ値を返す。

- `uniform` は画面全体で同じ値。リテラルだけでなくexpressionやautomationの評価値も含む。f32のuniformへ書き込み、1×1テクスチャを作らない。`enable32bitDataTextures` は保存するテクスチャの精度設定なので、このuniformを16bitへ丸めない。
- `texture` は接続元の出力と、その入力接続のfit/wrap設定を持つ。省略時は `cover` / `repeatMirrored`。入力テクスチャの保存形式は変更しない。
- 色の定数はレンダラーで一度だけpremultiplyする。画像テクスチャは既に乗算済みとして読み、そのまま返す。スカラー・ベクトル・汎用データには乗算しない。未接続入力は0（色なら透明）のuniformとする。

`generateShaderInputs()` は宣言、`read_<入力名>(position)` 関数、binding配置を同時に生成する。引数は中央原点、+Yが上の[-1, 1]座標。スカラーはf32、ベクトルはvec2f、色・汎用データはvec4fを返す。入力名はWGSL関数名の一部になるため固定の識別子を使う。

`createShaderInputBindings()` は生成した配置に合わせてuniformとbind groupを管理する。`update()`にはそのpassの実際の出力サイズを渡す。入力ごとのサイズからfit倍率を求め、値・fitの変更はuniform、wrap・テクスチャの変更はbindingへ反映する。pipelineの切替は入力種別が変わった場合に行う。colorMixでは実際に使う構成だけ作り、最大8構成を保持する。bufferはエフェクトのdisposeで全構成分を破棄する。

`createShaderInputPipeline()` は通常のrender pipelineでこの構成管理を行うヘルパー。エフェクト固有のuniform等を `internalLayouts` のgroupに置き、その後ろに生成入力のgroupを追加する。`update()`で返すpipelineとbindGroupを描画時に設定し、`dispose()`で入力bufferを破棄する。入力種別の組合せは直近16構成まで保持し、入力の多いエフェクトでもbufferを無制限に残さない。各エフェクト固有のリソースはエフェクト側で破棄する。

fitは座標変換だけを行い、containの余白にもwrapを適用する。clampは端を伸ばし、repeatは繰り返し、repeatMirroredは鏡像で繰り返す。transparentはclamp samplerに透明な隣接画素との補間分を掛ける。定数入力にはfit/wrapを適用しない。参照位置の変換だけを共通化し、ベクトルの成分変換やエフェクト固有の幾何計算は行わない。

通常はimplicit samplingを使う。生成関数は分岐の外でtextureSampleを呼ぶが、呼び出し側にもfragmentのuniformな制御フローが必要。computeや画素ごとに異なる分岐から呼ぶ場合は生成時に `level0` を指定する。履歴の厳密な整数画素アクセスは、このAPIへ置き換えない。

gradientでは `scalarGradients: true` と `sampling: 'level0'` を指定し、生成された `readGradient_<入力名>(position, calculate)` から値と画面座標X/Yに対する偏微分をvec3fとして取得する。テクスチャはfit/wrap適用後の双線形補間を解析的に微分し、uniformの偏微分は0とする。scalar出力だけを使う場合はoverrideでcalculateをfalseにし、微分用の追加サンプルを除去する。vector出力のpipelineとbufferも使用時に生成する。エフェクト本体のFit modeはグラデーション形状を決める設定なので残し、入力接続のfitとは独立に扱う。

## 残る移行対象

今回の移行は単一出力のrender passを中心に行った。以下は個別の対応が必要なため従来方式を維持している。

- accumulate、frameDifference、opticalFlow、pixelSort、histogramなど: 履歴・整数画素・computeのアクセスと、通常の入力サンプリングを分けて扱う。
- blur、bloom、liquidMetalなど: 中間テクスチャを使う複数passへの適用範囲を整理する。
- transform、scalarGradient: 幾何変換・微分に必要な入力サイズの参照と、fit変換の関係を整理する。
- quadtreeFilter、tearings: 既存のnearestサンプリングを維持するか検討する。現行の生成APIはlinearサンプリング。
- blockShuffle、drosteRegression、testStructArrayなど: 個別のfit計算や構造化パラメータの扱いを含むため、別途移行する。

## 検証

`pnpm test` でCPU側の接続解決・リソース更新・キャッシュを検証する。GPUテストは `CHROME_PATH` を設定すると同じコマンドで実行される。未設定時はGPUテストだけスキップする。

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test packages/renderer/test/shader-inputs*.test.mjs
```

GPUテストはheadless Chromeで実際のcolorMixと生成関数を実行し、全入力構成、異なるアスペクト比、fit/wrap、乗算済みアルファ、16bitデータと対応GPU上での32bitデータを画素比較する。

追加移行した15エフェクトも、uniformと同じ値のテクスチャを使って全入力構成の描画結果を比較する。16bitと対応GPUでの32bitの両方、キャッシュ退避後の再生成を含む。

gradientは7入力の全128構成で単一／複数出力を比較する。符号付き浮動小数点の値と微分を直接読み戻し、linear/radial、入力のfit/wrap、transparentの1×1入力の境界を検証する。
