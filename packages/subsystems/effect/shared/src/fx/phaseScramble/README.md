# Phase Scramble

画像の2次元Fourier係数へランダムな位相差を加え、振幅を保ったまま輪郭・構造を崩す。Globalと、50%重なるBlocksに対応する。Referenceからの位相移植は行わない。他エフェクトの実装には依存せず、既存の`_def_.ts`・`_impl_.ts`のglobで登録される。

## パラメータ

| 設定 | 既定値 | 意味 |
| --- | --- | --- |
| Processing | Global | Globalは画面全体、Blocksは重なった正方形のブロックごとに処理 |
| Amount | 0.5 | 位相差の適用量。0〜1。画像同士のクロスフェードではない |
| Minimum / Maximum Frequency | 2 / 64 | Size Referenceあたりの周期数で対象帯域を指定 |
| Frequency Softness | 2 | 帯域の境界をsmoothstepでぼかす幅。周期数と同じ単位 |
| Seed | 0 | 周波数・ブロックごとの位相差を決める |
| Evolution | 0 | 位相差の連続的な変化量。時刻の式やキーでアニメーション可能 |
| Channel Mode | RGB Linked | LinkedはRGB共通、Independentはチャンネル別の位相差 |
| Boundary | Mirror | 描画領域の端でMirrorまたはRepeatしてから入力のFitを適用 |
| Global Analysis Resolution | 256 | Globalの解析領域の長辺。各軸を16以上の2冪へ切り上げる |
| Block Size | 25% | Size Referenceに対するブロックの一辺の比率。Blocksのみ使用 |
| Block Analysis Resolution | 32 | 各ブロック一辺の解析サンプル数。Blocksのみ使用 |
| Size Reference | Long Side | ブロック寸法と周波数の周期数を換算する共通の基準寸法 |

上下限が逆なら交換し、負の周波数・Softnessは0へ制限する。非有限のAmount・周波数・Softness・Seed・Evolutionは既定値へ戻す。Block Sizeは正の有限値が必要で、不正値はエラーとする。Amount=0・定数入力ではFFTを省略し、元の乗算済みRGBAをそのまま返す。

## 解析領域と境界

解析解像度は出力画素数から独立している。同じ縦横比の解像度変更では、解析領域・周波数・ブロック配置・乱数が変わらない。各解析点は出力座標上の固定した2×2の面積サンプルをpremultiplied RGBのまま平均する。有限個のサンプルなので、極端な高周波の入力を厳密に面積積分するものではない。

GlobalのRepeatでは画面全体を周期領域としてFFTに含める。Mirrorでは各軸を反射した2倍の範囲を含め、FFTの幅・高さも2倍にする。変換後は元の左上の描画領域だけを参照する。反射領域を含む物理寸法で周波数を換算し、Mirrorへ切り替えても帯域の周期数を半分にしない。

BlocksはSize Referenceから定めた正方形を各軸50%ずつ重ねる。最初のブロックを画面の半ブロック外側へ置き、画面端も四つのブロックで覆う。画面外を含む入力はBoundaryのMirror・Repeatで読む。ブロックごとに異なる位相差を使い、合成時の2次元周期Hann窓で滑らかに繋ぐ。窓は解析には掛けず、差分の合成だけに使う。一様入力の窓形状自体を乱して模様を作らないためである。窓の合計でも明示的に正規化する。

どちらも入力のFit・Wrap・Filterは共通のShaderInput参照に任せる。Boundaryは素材テクスチャの端ではなく描画領域に適用し、入力接続のFitより前に折り返す。

## Fourier変換と位相差

GPU上のradix-2 FFTで、行・列の順に前向き変換し、係数へ次の位相回転を適用する。

```text
F_processed(k) = F_input(k) × exp(i × Amount × frequencyWeight(k) × phaseOffset(k))
```

実際には`F_processed - F_input`だけを逆FFTし、元の高解像度画像へ差分を戻す。解析解像度まで元画像の細部を縮小せず、帯域外の差分は厳密に0となる。逆FFTは各段で1/2に正規化する。計算bufferは精度設定によらずf32で、出力はINTERMEDIATE_TEXTURE_FORMATに従う。

DCと自己共役のNyquist成分は変更しない。他の周波数は共役対の片側から乱数を生成し、対へ逆符号の位相差を適用する。これにより、各周波数振幅を保ちつつ逆変換を実数に保つ。RGB Linkedではチャンネル間の相対位相を保ち、RGB Independentではチャンネルごとに異なる位相差を使う。

乱数はSeedのf32表現・周波数番号・ブロック番号・チャンネル・Evolutionの整数部から生成する。整数部の前後の位相差を実数のままsmoothstep補間するため、±πの折返しやEvolutionの整数境界で不連続にならない。Seedや解析解像度を変えるとパターンも変化する。描画履歴・経過フレーム数・timeには依存せず、同じ入力とパラメータで再現する。

## 透明度・値域・振幅保持の範囲

入力と解析はpremultiplied RGBを使い、元のalphaを保持する。出力は以下とする。

```text
output.rgb = original.rgb + reconstructedDifference.rgb × original.alpha
output.alpha = original.alpha
```

差分だけを元のalphaで制限して透明領域への漏れを防ぎ、元のRGBを二重にpremultiplyしない。alpha=0の画素は、発光RGBも含めて入力のまま保持する。HDR・負のRGBを含め、処理結果は0〜1へclampしない。

振幅保持はFFT解析領域での位相回転の性質である。不透明・Repeat・解析と一致する画素格子なら、最終画像でも周波数振幅・DCを数値誤差の範囲で保持する。Mirrorの切り出し、Blocksの重なり合成、解析差分の補間、元画像の高周波の保持、alphaでの差分制限を行った最終画像全体では厳密な振幅保持は保証しない。色のヒストグラムや画素値の範囲も保存しない。

## GPUリソースと検証

FFT本体・帯域重み・解析領域はeffect/sharedの`fourier`を使う。乱数・位相操作・パス順序・bufferの寿命はPhase Scrambleが所有し、他エフェクトの実装を参照しない。

複素RGBは実部・虚部の各vec4f、合計32byte/解析点で保存し、二つのstorage bufferを交互に使う。各FFT段・位相操作・取得に独立したuniform領域を割り当てる。行列サイズやブロック数が変わるとリソースを再作成する。buffer・dispatchの上限を超える場合はエラーにし、解像度や品質を自動で下げない。GlobalのMirrorはRepeatの4倍の解析点を持つ。

`test/phase-scramble.test.mjs`で解析領域・物理寸法・リソース上限を検証する。`CHROME_PATH`を指定して`node --test packages/subsystems/effect/shared/test/phase-scramble.gpu.test.mjs`を実行すると、実際のWebGPUでCPUの直接DFTとの一致・振幅保持・共役対・Hann合成の正弦波解析解・境界・透明度・HDR・Evolution・解像度独立性を確認する。
