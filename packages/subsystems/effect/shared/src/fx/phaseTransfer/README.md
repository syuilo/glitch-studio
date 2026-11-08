# Phase Transfer

主入力InputのFourier振幅を保持し、副入力Referenceの位相へ近づける。Globalと50%重なるBlocksに対応し、元画像へ解析差分だけを戻して細部・alphaを保持する。Phase Scrambleを含む他のエフェクトには依存せず、FFTと領域計算はeffect/sharedの`fourier`を使う。登録は既存の`_def_.ts`・`_impl_.ts`のglobに従う。

## パラメータ

| 設定 | 既定値 | 意味 |
| --- | --- | --- |
| Input / Reference | 透明 | 振幅の取得元と、位相の移植元。自動解像度はInputだけから求める |
| Processing | Global | 画面全体、または重なる正方形ブロックごとに処理 |
| Amount | 0.5 | 位相差の適用量。0で元画像、1で対象帯域の参照位相へ到達 |
| Minimum / Maximum Frequency | 2 / 64 | Size Referenceあたりの周期数で対象帯域を指定 |
| Frequency Softness | 2 | 帯域境界のなだらかさ。周期数と同じ単位 |
| Minimum Phase Amplitude | 0.00001 | 位相の判断に使う係数の最小振幅。FFT点数で正規化した値 |
| Channel Mode | RGB Linked (Luminance Phase) | Linkedは輝度の位相差をRGB共通に適用、Independentは色成分ごとに移植 |
| Boundary | Mirror | 描画領域の端でMirrorまたはRepeatしてから各入力のFitを適用 |
| Global Analysis Resolution | 256 | Globalの解析領域の長辺。各軸を16以上の2冪へ切り上げる |
| Block Size | 25% | Size Referenceに対するブロックの一辺の比率 |
| Block Analysis Resolution | 32 | 各ブロック一辺の解析点数 |
| Size Reference | Long Side | 周波数とブロック寸法の換算基準 |

Amountは0〜1へ制限する。負の周波数・Softness・Minimum Phase Amplitudeは0へ制限し、周波数の上下限が逆なら交換する。非有限値は各設定の既定値へ戻す。Block Sizeは正の有限値が必要で、不正値はエラーとする。

## 位相の移植

両入力のpremultiplied RGBを同じ解析領域で2×2の固定サンプルから取得し、独立にFFTする。次の回転を行った係数と主入力の係数の差だけを逆FFTする。

```text
phaseDifference(k) = arg(F_reference(k) × conjugate(F_input(k)))
F_processed(k) = F_input(k) × exp(i × Amount × frequencyWeight(k) × phaseDifference(k))
```

角度差は基本的に最短経路を使う。180°付近はf32誤差で回転方向が反転しやすいため、-πから0.001rad以内の負の角度には2πを加えて正方向へ揃える。角度をπへ丸めないので、Amount=1では参照位相へ正確に到達する。反対側の共役成分には必ず逆符号の角度を適用し、逆FFTを実数に保つ。DCと自己共役のNyquist成分は元の係数を維持する。

RGB Independentでは各RGB係数の位相差を使う。RGB Linkedでは係数のRGBへ`(0.2126, 0.7152, 0.0722)`を掛けて輝度係数を作り、その位相差をRGB共通へ適用する。Linkedは主入力のチャンネル間の相対位相を保つが、輝度のない色境界を移す場合はIndependentが適する。

主入力または副入力の係数の振幅がMinimum Phase Amplitude以下なら位相を変更しない。振幅はFFTの幅×高さで割って判断し、解析解像度で閾値の意味を変えない。Linkedの判断対象は輝度、Independentでは各色の係数となる。完全透明・一様なReferenceの非DC成分は位相の移植に使わない。定数入力・定数Reference・Amount=0ではFFT用bufferを確保せず元画像を返す。

同じ画像を両入力へ渡せば変化しない。入力画像が異なる場合でも、副入力の振幅・平均色を主入力へコピーしない。主入力にない周波数成分を新しく作る処理ではない。

## Global / Blocksと境界

GlobalのRepeatは画面全体を周期領域として変換する。Mirrorでは各軸を反射した2倍の範囲をFFTへ含め、元の描画領域を切り出す。周波数の物理単位は拡張後の領域寸法で換算する。

BlocksはSize Referenceで定めた正方形を50%ずつ重ねる。画面の半ブロック外側から配置し、端も四つの窓で覆う。各ブロックのInputとReferenceを個別に変換して位相差を求め、2次元周期Hann窓で差分を合成する。窓は合成時だけに使い、一様な画像を窓の形として変化させない。

Boundaryは素材テクスチャではなく描画領域に適用し、その後のFit・Wrap・Filterは各接続に任せる。異なる解像度・縦横比のReferenceも同じ描画領域で評価する。Referenceのalphaは解析RGBの寄与を決めるが、配置先へ局所的に適用するマスクではない。

## 出力・決定性

出力は`original.rgb + reconstructedDifference.rgb × original.alpha`、alphaは主入力のまま。元のRGBを二重にpremultiplyせず、完全透明の画素はRGBA=0にする。負のRGB・HDRを含めてclampしない。Referenceのalphaで主入力のalphaを置き換えない。

位相回転は解析領域の振幅を保持する。不透明・等倍・Repeatでは最終画像でも振幅を数値誤差の範囲で保持するが、Mirrorの切り出し、Blocksの窓合成、解析差分の補間、高解像度の細部保持、alphaによる差分制限後の最終画像全体で厳密な振幅保持は保証しない。

描画履歴・時刻・フレーム番号に依存せず、同じ両入力・設定なら同じ結果になる。解析領域と物理寸法は出力画素数から独立する。動画では入力の位相差が補間経路の境界をまたぐと、中間のAmountで結果が切り替わることがある。時間方向のアンラップや平滑化は行わない。

## リソースと検証

複素RGBは実部・虚部の各vec4f、32byte/解析点。三つのstorage bufferを使い、主入力のスペクトルを保持したまま副入力を変換する。移植後は主入力bufferを逆FFTに再利用する。各段に独立したuniform領域を割り当てる。計算はf32、出力はintermediateTextureFormatに従う。buffer・dispatch上限を超える設定は精度を落とさずエラーにする。

`test/phase-transfer.test.mjs`でスペクトルのbuffer寿命・長方形の段数・物理単位・リソース上限を検証する。`CHROME_PATH`を指定して`node --test packages/subsystems/effect/shared/test/phase-transfer.gpu.test.mjs`を実行すると、CPU直接DFT・正弦波の解析解との一致、振幅保持、参照位相、180°補間、弱い係数、独立したFit、透明度、両Processing方式、再現性、解像度独立性を実WebGPUで検証する。
