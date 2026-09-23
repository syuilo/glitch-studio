# 生成するシェーダー入力

すべてのエフェクトは `implementEffect<typeof definition>` で定義し、`canNode` パラメータを `ShaderInput` として受け取る。入力方式を切り替える指定や旧方式の定数テクスチャ管理は存在しない。構造体・配列内のcanNodeにも同じ規約を適用する。

生成関数の主な利用先:

- 合成: colorMix、colorBlend、dataMix、dataBlend
- 履歴・蓄積: accumulate、frameDifference（外部入力のみ。履歴は同一画素をtextureLoadで読む）
- 動き推定: opticalFlow
- 画像集計: histogram、waveform
- データ生成・演算: composeVector、remap、multiply、rgbTo、snoise、gradient、scalarGradient
- 画像加工: symbols、channelShift、chromaticAberration、colorBlocks、lcd、rainDropsOnWindow1、rainDropsOnWindow2、vectorDisplacement、blockShuffle、blur、quadtreeFilter、tearings、pixelSort、bloom、drosteRegression、water、liquidMetal、transform

入力のfit/wrapは接続設定に統一する。従来の独立したfitModeA/B/Amountやwrapパラメータは削除している。未接続の定数は位置によらず同じ値を返す。

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

gradientでは `scalarGradients: true` と `sampling: 'level0'` を指定し、生成された `readGradient_<入力名>(position, calculate)` から値と画面座標X/Yに対する偏微分をvec3fとして取得する。テクスチャはfit/wrap適用後の双線形補間を解析的に微分し、uniformの偏微分は0とする。nearestも画素内では一定のため入力の偏微分を0とし、不連続な画素境界も0と定義する。この場合は微分用の追加サンプルを省略する。gradient自身の形状による微分は維持する。scalar出力だけを使う場合はoverrideでcalculateをfalseにし、微分用の追加サンプルを除去する。vector出力のpipelineとbufferも使用時に生成する。エフェクト本体のFit modeはグラデーション形状を決める設定なので残し、入力接続のfitとは独立に扱う。

pixelSortは出力画素の中心にfit/wrapと指定されたfilter（既定値linear）を適用した画像をソートする。computeの閾値・輝度判定とfragmentの出力で同じ生成関数・入力bindingを共有し、画素インデックスを並べ替えるmerge処理は維持する。uniform/textureの2構成を保持し、追加の中間テクスチャは作らない。拡大縮小やfitによって補間される場合、以前のnearest読み取りとは閾値判定やソート順が変わる。

bloomは外部入力を読むprefilterとcompositeに生成関数を使う。両方の入力binding更新には最終出力サイズを渡し、作業解像度の丸めによるfitのずれを防ぐ。prefilterのサンプル間隔にもfit後の入力画素サイズを反映し、uniform入力では間隔を0にする。内部の縮小・拡大と光の合成用テクスチャはlinear/clampを維持し、接続のfilter/wrapは適用しない。中間テクスチャの追加はなく、既存のピラミッドを使う。

frameDifferenceは比較・履歴保存で同じ入力参照と保存精度の丸めを使う。黒背景の見た目は乗算済みRGBをそのまま比較し、alphaの二重乗算を避ける。histogramは入力集計のcomputeだけ生成関数へ移し、集計用の間引き解像度とは独立に最終出力の比率でfitを決める。両者とも未接続を表す全成分0のuniformでは従来の空入力処理を行う。drosteRegressionの独立したWrap設定は入力接続へ統一する。

liquidMetalはfit/wrap/filter適用後のアルファ形状を出力座標系で判定し、原則短辺512px・出力と同じ比率の作業領域でPoisson前処理を行う。形状判定と最終描画は同じ生成入力bindingを共有し、fitは最終出力サイズを基準にする。uniform入力は一定アルファの全面形状として扱う。入力のwrapとは独立に計算領域の端は境界値0を維持し、40回のRed-Black SORも変更しない。内部の輪郭テクスチャはlinear/clampで読み、ぼかし幅は元画像ではなく内部解像度基準の6画素とするため、従来とは輪郭の柔らかさが変わり得る。入力RGBは使わず、生成した金属色を入力アルファでpremultiplyして背景に合成する。

transformはInput・Translation・Scale・Rotationの4入力を生成関数で読む。変形パラメータは出力先の座標で評価し、画像だけ拡縮→回転→移動の逆変換後に読む。Translationの+1は画面幅/高さの半分の移動で、画像サイズ・拡縮・回転に依存しない。UIの操作範囲は±2とし、式やノード入力の値は制限しない。回転は出力アスペクト比で距離の単位を揃え、負のScaleは反転、いずれかの軸の絶対値が0.000001未満なら透明を返す。独立したWrapと固定contain配置は廃止し、接続のfit/wrap/filter（省略時cover/repeatMirrored/linear）を使う。uniformの色は通常の変形では一定値のままとなる。

opticalFlowは履歴保存時に生成入力を読み、fit/wrap/filter適用後に表示される画像の動きを出力座標系の毎秒のベクトルとして推定する。fitの基準は最終出力サイズとし、最大辺256pxの履歴への縮小は4点平均を維持する。nearestでも各点を取得した後の平均は行う。輝度は乗算済みRGBから直接求め、alphaを二重に掛けない。履歴の差分は整数座標のtextureLoad、内部の移動量の平滑化・拡大はlinear/clampのままとする。入力種別またはfit/wrap/filterが変わった場合は履歴を取り直し、その回の出力は0にする。テクスチャのオブジェクト切替だけでは履歴をリセットしない。初回・無効な時間差・250ms超の間隔でのリセットも維持する。未接続を含むuniform入力は空間的に一定なため出力0となる。追加の中間テクスチャは作らず、履歴・移動量の16/32bit設定も維持する。

scalarGradientは `readGradient_input(position, true)` を使い、fit/wrap適用後の双線形補間関数の局所的な勾配を返す。従来の約1画素幅の有限差分・端の片側差分は使わず、境界も接続のwrapに従う。uniformとnearestは境界を含め勾配0とし、1x1テクスチャでもtransparentなら境界の傾きを反映する。偏微分のX成分を出力アスペクト比で割って等方的な座標へ変換し、必要ならNormalizeを行い、Strengthを掛けて各軸[-1,+1]の変位座標へ戻す。この最後の変換でもX成分をアスペクト比で割る。出力は引き続き精度設定に応じたrg16float/rg32float。局所的な微分への変更により、細かな模様や画像端では従来より鋭く変化する場合がある。

waveformの共通ユーティリティはShaderInputを受け取り、computeの集計で生成入力を読む。fitSize（画像を配置する領域）、sampleSize（サンプル数）、size（波形の位置・強度の分解能）を分離する。エフェクトではfitSizeに最終出力サイズを渡し、Resolutionの間引きやVerticalの軸交換でfitが変わらないようにする。UIの解析パネルは元画像全体を解析するため、textureShaderInputでstretch/clamp/linearを明示し、fitSizeに元画像サイズを渡す。入力RGBをunpremultiplyして強度を求め、alphaを集計の重みにする既存の処理は維持する。uniformの色は全位置で同じ強度となり、未接続の透明uniformは集計に寄与せず背景と有効ならグリッドだけを表示する。集計pipelineはuniform/textureの2構成を必要時に作り、集計後の描画pipelineは共有する。中間テクスチャは追加しない。

## 特殊な入力処理

ShaderInputは入力の受け渡し規約であり、すべての読み取りを生成関数へ強制するものではない。整数画素の厳密な参照や専用テクスチャへの変換が必要なら、texture入力のGPUTextureを直接扱い、uniformの場合もエフェクトの仕様に応じて処理する。画像素材・動画フレーム・音声などのcanNodeではないパラメータの受け渡しは、それぞれの型に従う。

Visual ModuleのIn/Out・バイパス・タイムラインのレイヤー間は、サンプリング設定を持たないNodeOutput（uniformまたはtexture）を受け渡す。定数はテクスチャ化せず、受け取り側の接続設定と組み合わせてShaderInputにする。色は出力値になる時に一度だけpremultiplyし、後段では再乗算しない。scalar/vectorを別の型へ接続するときはr/rgテクスチャと同様に欠けた成分を0、alphaを1とする。最終表示・集計の境界だけOutputTextureResolverで必要に応じて1x1テクスチャ化する。借用テクスチャは変換・破棄せず、定数用テクスチャは成分数ごとに再利用し、値が変わったときだけ転送する。paramInputsで渡されたノード出力は、定数でもPARAM式の対象外（通常のparamValuesは従来どおり参照可能）。画像未指定・読み込み前のfallbackTextureは引き続き使用する。testStructArrayもShaderInputを受け取るが、描画処理はまだ実装していない。

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
