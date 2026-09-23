# 生成するシェーダー入力

`implementEffect<typeof definition, 'shaderInput'>` と `inputMode: 'shaderInput'` を指定したエフェクトでは、`canNode` パラメータを `ShaderInput` として受け取る。未移行のエフェクトは従来どおりGPUTextureを受け取る。

現在の導入先:

- 合成: colorMix、colorBlend、dataMix、dataBlend
- 履歴・蓄積: accumulate、frameDifference（外部入力のみ。履歴は同一画素をtextureLoadで読む）
- 画像集計: histogram
- データ生成・演算: composeVector、remap、multiply、rgbTo、snoise、gradient
- 画像加工: symbols、channelShift、chromaticAberration、colorBlocks、lcd、rainDropsOnWindow1、rainDropsOnWindow2、vectorDisplacement、blockShuffle、blur、quadtreeFilter、tearings、pixelSort、bloom、drosteRegression、water、liquidMetal、transform

移行済みのエフェクトでは、入力のfit/wrapは接続設定に統一する。従来の独立したfitModeA/B/Amountやwrapパラメータは削除している。未接続の定数は位置によらず同じ値を返す。

- `uniform` は画面全体で同じ値。リテラルだけでなくexpressionやautomationの評価値も含む。f32のuniformへ書き込み、1×1テクスチャを作らない。`enable32bitDataTextures` は保存するテクスチャの精度設定なので、このuniformを16bitへ丸めない。
- `texture` は接続元の出力と、その入力接続のfit/wrap/filter設定を持つ。省略時は `cover` / `repeatMirrored` / `linear`。入力テクスチャの保存形式は変更しない。
- 色の定数はレンダラーで一度だけpremultiplyする。画像テクスチャは既に乗算済みとして読み、そのまま返す。スカラー・ベクトル・汎用データには乗算しない。未接続入力は0（色なら透明）のuniformとする。

`generateShaderInputs()` は宣言、`read_<入力名>(position)` 関数、binding配置を同時に生成する。引数は中央原点、+Yが上の[-1, 1]座標。スカラーはf32、ベクトルはvec2f、色・汎用データはvec4fを返す。入力名はWGSL関数名の一部になるため固定の識別子を使う。

`createShaderInputBindings()` は生成した配置に合わせてuniformとbind groupを管理する。`update()`にはそのpassの実際の出力サイズを渡す。入力ごとのサイズからfit倍率を求め、値・fitの変更はuniform、wrap・filter・テクスチャの変更はbindingへ反映する。filterは境界処理・微分用のuniformにも反映する。pipelineの切替は入力種別が変わった場合に行う。colorMixでは実際に使う構成だけ作り、最大8構成を保持する。bufferはエフェクトのdisposeで全構成分を破棄する。

`createShaderInputPipeline()` は通常のrender pipelineでこの構成管理を行うヘルパー。エフェクト固有のuniform等を `internalLayouts` のgroupに置き、その後ろに生成入力のgroupを追加する。`update()`で返すpipelineとbindGroupを描画時に設定し、`dispose()`で入力bufferを破棄する。入力種別の組合せは直近16構成まで保持し、入力の多いエフェクトでもbufferを無制限に残さない。各エフェクト固有のリソースはエフェクト側で破棄する。

fitは座標変換だけを行い、containの余白にもwrapを適用する。clampは端を伸ばし、repeatは繰り返し、repeatMirroredは鏡像で繰り返す。transparentはlinearの場合にclamp samplerへ透明な隣接画素との補間分を掛け、nearestの場合はUVの[0,1)外を0にする。定数入力にはfit/wrap/filterを適用しない。参照位置の変換だけを共通化し、ベクトルの成分変換やエフェクト固有の幾何計算は行わない。

入力ポートのFilter modeメニューでlinear／nearestを選択する。変更はUndo/Redoに対応し、配線元の差し替えでも保持する。未接続入力では設定できない。新方式へ未移行のエフェクトにはこの設定は適用されない。wrap/filterの組合せごとにsamplerをキャッシュし、filterの変更ではpipelineを再生成しない。描画結果のキャッシュは無効化する。

通常はimplicit samplingを使う。生成関数は分岐の外でtextureSampleを呼ぶが、呼び出し側にもfragmentのuniformな制御フローが必要。computeや画素ごとに異なる分岐から呼ぶ場合は生成時に `level0` を指定する。履歴の厳密な整数画素アクセスは、このAPIへ置き換えない。

gradientでは `scalarGradients: true` と `sampling: 'level0'` を指定し、生成された `readGradient_<入力名>(position, calculate)` から値と画面座標X/Yに対する偏微分をvec3fとして取得する。テクスチャはfit/wrap適用後の双線形補間を解析的に微分し、uniformの偏微分は0とする。nearestも画素内では一定のため入力の偏微分を0とし、不連続な画素境界も0と定義する。この場合は微分用の追加サンプルを省略する。gradient自身の形状による微分は維持する。scalar出力だけを使う場合はoverrideでcalculateをfalseにし、微分用の追加サンプルを除去する。vector出力のpipelineとbufferも使用時に生成する。エフェクト本体のFit modeはグラデーション形状を決める設定なので残し、入力接続のfitとは独立に扱う。

pixelSortは出力画素の中心にfit/wrapと指定されたfilter（既定値linear）を適用した画像をソートする。computeの閾値・輝度判定とfragmentの出力で同じ生成関数・入力bindingを共有し、画素インデックスを並べ替えるmerge処理は維持する。uniform/textureの2構成を保持し、追加の中間テクスチャは作らない。拡大縮小やfitによって補間される場合、以前のnearest読み取りとは閾値判定やソート順が変わる。

bloomは外部入力を読むprefilterとcompositeに生成関数を使う。両方の入力binding更新には最終出力サイズを渡し、作業解像度の丸めによるfitのずれを防ぐ。prefilterのサンプル間隔にもfit後の入力画素サイズを反映し、uniform入力では間隔を0にする。内部の縮小・拡大と光の合成用テクスチャはlinear/clampを維持し、接続のfilter/wrapは適用しない。中間テクスチャの追加はなく、既存のピラミッドを使う。

frameDifferenceは比較・履歴保存で同じ入力参照と保存精度の丸めを使う。黒背景の見た目は乗算済みRGBをそのまま比較し、alphaの二重乗算を避ける。histogramは入力集計のcomputeだけ生成関数へ移し、集計用の間引き解像度とは独立に最終出力の比率でfitを決める。両者とも未接続を表す全成分0のuniformでは従来の空入力処理を行う。drosteRegressionの独立したWrap設定は入力接続へ統一する。

liquidMetalはfit/wrap/filter適用後のアルファ形状を出力座標系で判定し、原則短辺512px・出力と同じ比率の作業領域でPoisson前処理を行う。形状判定と最終描画は同じ生成入力bindingを共有し、fitは最終出力サイズを基準にする。uniform入力は一定アルファの全面形状として扱う。入力のwrapとは独立に計算領域の端は境界値0を維持し、40回のRed-Black SORも変更しない。内部の輪郭テクスチャはlinear/clampで読み、ぼかし幅は元画像ではなく内部解像度基準の6画素とするため、従来とは輪郭の柔らかさが変わり得る。入力RGBは使わず、生成した金属色を入力アルファでpremultiplyして背景に合成する。

transformはInput・Translation・Scale・Rotationの4入力を生成関数で読む。変形パラメータは出力先の座標で評価し、画像だけ拡縮→回転→移動の逆変換後に読む。Translationの+1は画面幅/高さの半分の移動で、画像サイズ・拡縮・回転に依存しない。UIの操作範囲は±2とし、式やノード入力の値は制限しない。回転は出力アスペクト比で距離の単位を揃え、負のScaleは反転、いずれかの軸の絶対値が0.000001未満なら透明を返す。独立したWrapと固定contain配置は廃止し、接続のfit/wrap/filter（省略時cover/repeatMirrored/linear）を使う。uniformの色は通常の変形では一定値のままとなる。

## 残る移行対象

今回の移行は単一出力のrender passを中心に行った。以下は個別の対応が必要なため従来方式を維持している。

- opticalFlow: 低解像度の履歴フレームと移動量推定の座標系を維持しつつ、入力のfitを適用する必要がある。
- scalarGradient: 微分に必要な入力サイズの参照と、fit変換の関係を整理する。
- waveform: UIの解析表示でも使う共通ユーティリティがGPUTextureを受け取るため、共有APIの対応範囲を整理する。
- testStructArray: 構造化パラメータの実験用エフェクト。描画処理自体が未実装なので、その設計と合わせて対応する。

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
