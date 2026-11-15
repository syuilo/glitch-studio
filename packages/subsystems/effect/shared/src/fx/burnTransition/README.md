# Burn Transition

Mapの値が小さい部分からAを侵食してBを見せ、残ったAの境界を発光させる。Edge Intensityを0にすれば発光のない侵食になる。

## 入出力

- `inputA` / `inputB`: 画像または色。未接続は透明。
- `progress`: 0で完全なA、1で完全なB。範囲外はclamp。式・キー・scalar場に対応する。
- `map`: 切替順を決めるscalar場。0〜1へclampし、自動正規化しない。Noise、画像の輝度、範囲変換したSDFなどを接続できる。定数Mapでは全画面が同時に切り替わる。
- `output`: 発光を加えた画像。premultiplied alphaのlinear sRGB、HDR・負値を保持する。
- `mask`: Bの置換率（0=A、1=B）。
- `edge`: 発光帯の重み（0〜1）。Aの残存率を含み、画像の色・alpha、Edge Color、Edge Intensityには依存しない。

3出力は独立に遅延確保する。Mask/Edgeだけを使う場合は画像出力を確保せず、画像やEdge Colorを読む処理も除去する。scalar出力は16bit / 32bitに対応する。解像度はA/B/Mapを参照する。時間や履歴には依存しない。

## 境界

- `softness`: A/B間の混合全幅。Map値域に対する幅で、空間的な距離ではない。
- `edgeWidth`: まだAが残る側に置く発光帯の全幅。こちらもMap値域に対する幅。0なら発光しない。
- `reverse`: Mapによる順序だけを反転する。A→Bの関係は維持する。
- `antiAlias`: MapとProgressの閾値差の画素微分で境界をならす。細い発光帯も少なくとも画素幅まで広げる。離散Mapを硬く切り替えたい場合は無効にできる。

閾値はSoftnessの半幅とEdge Widthの大きい方だけ、0〜1の両端へ延長した範囲を移動する。Map=0/1や幅が大きい場合も、発光が端点で突然現れたり消えたりしない。両幅0かつAA無効では意図した硬い切替になり、定数Mapは一斉に切り替わる。

発光帯は切替境界からA側へEdge Widthだけ伸び、両端で滑らかに0となり中央で最大になる。Softnessが大きい場合は、混合中のAの残存率によって発光も減衰する。

## 発光の色と透明度

- `edgeColor`: 発光の加算色。色・画像ノードも接続できる。色のalphaは発光量を減らし、透明なら発光しない。
- `edgeIntensity`: 発光量の非負倍率。0で発光を無効にし、HDRの明るさを作れる。

発光RGBはEdge Colorの乗算済みRGB × Edge Intensity × Edge × Aのalphaとして加算する。出力alphaはA/Bの補間値を維持する。したがってAの完全透明部分には光を作らず、透明Bへ完全に切り替わった部分にも非ゼロRGBを残さない。

## パラメータの再検討

発光と混合を独立調整するためSoftness・Edge Intensity、順序の反転と離散Mapの制御のためReverse・Anti-aliasを追加した。内蔵Noise/Seedは既存のNoiseなどでMapを構成できるため持たない。空間距離を受け取らないのでSize Referenceも設けない。
