# 生成するシェーダー入力

すべてのエフェクトは `implementEffect<typeof definition>` で定義し、`canNode` パラメータを `ShaderInput` として受け取る。構造体・配列内のcanNodeにも同じ規約を適用する。

- `uniform` は画面全体で同じ値。リテラルだけでなくexpressionやautomationの評価値も含む。f32のuniformへ書き込み、1×1テクスチャを作らない。`enable32bitDataTextures` は保存するテクスチャの精度設定なので、このuniformを16bitへ丸めない。
- `texture` は接続元の出力と、その入力接続のfit/wrap/filter設定を持つ。省略時は `cover` / `repeatMirrored` / `linear`。入力テクスチャの保存形式は変更しない。
- 色の定数はレンダラーで一度だけpremultiplyする。画像テクスチャは既に乗算済みとして読み、そのまま返す。スカラー・ベクトル・汎用データには乗算しない。未接続入力は0（色なら透明）のuniformとする。

`generateShaderInputs()` は宣言、`read_<入力名>(position)` 関数、binding配置を同時に生成する。引数は中央原点、+Yが上の[-1, 1]座標。スカラーはf32、ベクトルはvec2f、色・汎用データはvec4fを返す。入力名はWGSL関数名の一部になるため固定の識別子を使う。

`createShaderInputBindings()` は生成した配置に合わせてuniformとbind groupを管理する。`update()`にはそのpassの実際の出力サイズを渡す。入力ごとのサイズからfit倍率を求め、値・fitの変更はuniform、wrap・filter・テクスチャの変更はbindingへ反映する。filterは境界処理・微分用のuniformにも反映する。pipelineの切替は入力種別が変わった場合に行う。colorMixでは実際に使う構成だけ作り、最大8構成を保持する。bufferはエフェクトのdisposeで全構成分を破棄する。

`createShaderInputPipeline()` は通常のrender pipelineでこの構成管理を行うヘルパー。エフェクト固有のuniform等を `internalLayouts` のgroupに置き、その後ろに生成入力のgroupを追加する。`update()`で返すpipelineとbindGroupを描画時に設定し、`dispose()`で入力bufferを破棄する。入力種別の組合せは直近16構成まで保持し、入力の多いエフェクトでもbufferを無制限に残さない。各エフェクト固有のリソースはエフェクト側で破棄する。

## 配列入力

schemaに `{ images: { array: 'color' } }` と指定すると、`update()`へ `ShaderInput[]` を渡せる。scalar/vector/color/anyの配列と固定入力を混在できる。構造体配列はエフェクト側で必要なフィールドを取り出す（例: `ctx.params.buzzs.map(item => item.image)`）。レンダラーは構造体・配列内のcanNodeも再帰的にShaderInputへ解決する。

```ts
const pipelines = createShaderInputPipeline({
	device, vertex, code,
	schema: { images: { array: 'color' }, selector: 'scalar' },
	targets: [{ format: wgpu.intermediateTextureFormat }],
	sampling: 'level0',
});
const variant = pipelines.update({ images: ctx.params.images, selector: ctx.params.selector }, outputTexture);
```

```wgsl
// indexの決め方はエフェクトの仕様。count_imagesは配列長を表すu32定数。
let index = u32(max(0.0, floor(read_selector(position))));
let color = read_images(index, position);
```

`read_<配列名>(index: u32, position: vec2f)` はswitchで該当要素だけを参照する。各要素は独立したuniformまたはtextureで、fit/wrap/filterも要素ごとに適用する。空配列・範囲外indexは型に応じた0（色なら透明）を返す。空配列だけでも有効なシェーダーとbindingを生成する。配列要素は画素ごとに異なる分岐で読めるよう、sampling指定によらずLOD 0を使う。固定入力のsampling指定は従来どおり。スカラー配列にはscalarGradientsを指定すると `readGradient_<配列名>(index, position, calculate)` も生成し、範囲外はvec3f(0)となる。

配列長と各要素のuniform/textureの組合せをpipelineのキャッシュキーに含める。長さや種別が変われば対応する構成を生成・再利用し、値・接続先・fit/wrap/filterだけの変更では再生成しない。LRUの上限は固定入力と同じ16構成。低レベルのgenerateShaderInputs/createShaderInputBindingsでも配列を利用できるが、長さ・種別の変更時は再生成が必要で、古いbindingsへの更新はエラーにする。

個別binding方式なので、texture要素ごとにテクスチャとサンプラーの枠を1つずつ使う。uniform要素はこれらの枠を使わない。入力groupだけでdeviceのtexture/sampler数・uniformサイズ・binding数の上限を超える場合は、リソース作成前にエラーとする。内部groupも含むpipeline全体の上限はGPU側でも検証されるため、エフェクトは内部で使う枠も考慮して候補数を決める。大量の候補を配列テクスチャへまとめる機能は含まない。

## サンプリング

fitは座標変換だけを行い、containの余白にもwrapを適用する。clampは端を伸ばし、repeatは繰り返し、repeatMirroredは鏡像で繰り返す。transparentはlinearの場合にclamp samplerへ透明な隣接画素との補間分を掛け、nearestの場合はUVの[0,1)外を0にする。定数入力にはfit/wrap/filterを適用しない。参照位置の変換だけを共通化し、ベクトルの成分変換やエフェクト固有の幾何計算は行わない。

入力ポートのFilter modeメニューでlinear／nearestを選択する。変更はUndo/Redoに対応し、配線元の差し替えでも保持する。未接続入力では設定できない。wrap/filterの組合せごとにsamplerをキャッシュし、filterの変更ではpipelineを再生成しない。描画結果のキャッシュは無効化する。

通常はimplicit samplingを使う。生成関数は分岐の外でtextureSampleを呼ぶが、呼び出し側にもfragmentのuniformな制御フローが必要。computeや画素ごとに異なる分岐から呼ぶ場合は生成時に `level0` を指定する。履歴の厳密な整数画素アクセスは、このAPIへ置き換えない。

## 特殊な入力処理

ShaderInputは入力の受け渡し規約であり、すべての読み取りを生成関数へ強制するものではない。整数画素の厳密な参照や専用テクスチャへの変換が必要なら、texture入力のGPUTextureを直接扱い、uniformの場合もエフェクトの仕様に応じて処理する。画像素材・動画フレーム・音声などのcanNodeではないパラメータの受け渡しは、それぞれの型に従う。

Visual ModuleのIn/Out・バイパス・タイムラインのレイヤー間は、サンプリング設定を持たないNodeOutput（uniformまたはtexture）を受け渡す。定数はテクスチャ化せず、受け取り側の接続設定と組み合わせてShaderInputにする。色は出力値になる時に一度だけpremultiplyし、後段では再乗算しない。scalar/vectorを別の型へ接続するときはr/rgテクスチャと同様に欠けた成分を0、alphaを1とする。最終表示・集計の境界だけOutputTextureResolverで必要に応じて1x1テクスチャ化する。借用テクスチャは変換・破棄せず、定数用テクスチャは成分数ごとに再利用し、値が変わったときだけ転送する。paramInputsで渡されたノード出力は、定数でもPARAM式の対象外（通常のparamValuesは従来どおり参照可能）。画像未指定・読み込み前のfallbackTextureは引き続き使用する。

## 検証

`pnpm test` でCPU側の接続解決・リソース更新・キャッシュを検証する。GPUテストは `CHROME_PATH` を設定すると同じコマンドで実行される。未設定時はGPUテストだけスキップする。

```powershell
$env:CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node --test packages/renderer/test/shader-inputs*.test.mjs
```

GPUテストはheadless Chromeで実際のcolorMixと生成関数を実行し、全入力構成、異なるアスペクト比、fit/wrap、乗算済みアルファ、16bitデータと対応GPU上での32bitデータを画素比較する。

追加移行した16エフェクトも、uniformと同じ値のテクスチャを使って全入力構成の描画結果を比較する。16bitと対応GPUでの32bitの両方、キャッシュ退避後の再生成を含む。

blockShuffleは画像とSizeの両入力を新方式で読む。本体のFit modeはブロック形状の設定として残す。GPUテストでは全4入力構成に加え、選択／非選択タイルの両方で接続のfit/wrapを検証する。

gradientは7入力の全128構成で単一／複数出力を比較する。符号付き浮動小数点の値と微分を直接読み戻し、linear/radial、入力のfit/wrap、transparentの1×1入力の境界を検証する。

Filter modeのテストでは、既定値・サンプラー再利用・描画キャッシュ無効化・メニューのUndo/Redoと設定保持を確認する。GPU上でもlinear/nearest切替、透明境界、gradientの入力微分を比較する。

配列入力のCPUテストは `node --test packages/renderer/test/shader-input-arrays.test.mjs packages/renderer/test/shader-inputs.test.mjs`。混在入力のアップロード、配列長・種別の構成切替、キャッシュ再利用・解放、上限超過、構造体配列の接続解決とキャッシュ無効化を確認する。既存のGPUテストにも、画素ごとの要素選択、空配列・範囲外、配列長変更後の再利用、要素別fit/filter/透明境界、スカラー配列の微分とvector/anyの空配列を追加している。
