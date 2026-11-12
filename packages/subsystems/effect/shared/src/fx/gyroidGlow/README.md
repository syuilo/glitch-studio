# Gyroid Glow

入り組んだ発光する膜と、その中を移動する発光球を生成する。入力画像は不要。膜の陰関数に近いほど光を強く加算する描画で、表面との衝突・遮蔽・吸収を計算するものではない。

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| Time | 0 | 膜の流れ・回転・発光球の移動を進める秒数。式に`TIME`を指定すると再生時刻に追従する |
| Zoom | 1 | 高さ基準の画角の拡大率。大きいほど狭い範囲を拡大する |
| Rotation | 0 | 構図の時計回りの回転。1で1周 |
| Fold Frequency | 1 | 膜の基準周波数0.6に対する倍率。画角とは独立して構造を細かくする |
| Fold Amount | 1 | 膜のうねりの強さ。0でうねりを消し、傾きによる平面状の分布にする |
| Sheet Tilt | [0.3, 0.9] | 膜の陰関数へ加えるX・Y方向の傾き。位置・角度ではなく無次元の係数 |
| Glow Width | 1 | 膜からの発光が広がる幅の倍率。0で膜の発光を消す |
| Sheet Strength | 1 | 二乗によるコントラスト処理前の膜の発光量。0で膜の発光を消す |
| Color Mode | Cosine | Cosineの周期配色、またはColor Rampによる自由な配色 |
| Color Ramp | 紫・シアン・橙・ピンク・紫 | Color Rampモードで使う配色。補間方式・補間色空間・各stopの色とalphaを編集できる |
| Color Frequency | 1 | 空間に沿って配色が繰り返す頻度の倍率。0ではColor Phaseで選んだ一色を使う |
| Color Phase | 0 | 両Color Modeに共通の配色位相。1で一巡する。一般的な色相回転ではない |
| Orb Color | 白 | 発光球のlinear RGB色。ノード接続可。alphaは発光量へ一度だけ乗算する |
| Orb Strength | 1 | コントラスト処理前の発光球の光量。0で発光球を消す |
| Exposure | 0 EV | コントラスト処理後・トーン処理前のRGBを`2^EV`倍する |
| Tone Mapping | Soft Shoulder | `1-exp(-RGB)`でハイライトを圧縮。HDRでは圧縮しない |
| Compositing | Opaque | 黒背景でalpha=1。Emissionでは同じRGBをalpha=0の発光として出力する |
| Maximum Steps | 120 | 詳細設定。レイを進める最大反復回数。1〜120 |

Timeは明示的な通常パラメータで、描画時刻や前フレームを直接参照しない。停止・逆再生・シークでも同じ設定から同じ結果を得る。動きを個別に分離する設定は持たない。

高さ基準の画角を使い、横幅を縦横比で換算してから回転する。縦横比を変えても構造は歪まず、水平に見える範囲が変わる。同じ縦横比での解像度変更では構図を維持する。内部3D座標を公開する位置・距離パラメータとして扱わず、Size Referenceは持たない。

Maximum Stepsを減らすとレイが途中で打ち切られ、奥の膜・発光球や明るさが変化する。純粋な画質設定ではない。軽量化にはエフェクト共通の解像度倍率も利用できる。高解像度では共通の自動タイル描画の対象になる。

膜の陰関数は、周波数を指定したうねりにFold Amountを掛け、内部のレイ座標に対する`0.45 * (X * Sheet Tilt.x + Y * Sheet Tilt.y) + 0.6`を加える。Xは右、Yは上。傾きの符号を反転すると、その軸に対する傾斜の向きが反転する。Fold AmountとSheet Tiltがともに0なら空間的に一様な場になる。

Glow Widthは陰関数の0から離れるにつれて減衰する発光の幅であり、画面上の距離や膜の厚さではない。幅を広げると中心の発光ピークを保ったまま周囲が明るくなり、総光量は増える。歩幅の計算には使わないため、Glow Widthを変えてもレイの到達位置や発光球の描画は変わらない。非常に狭い幅では光る領域をサンプルできず、細部が欠けることがある。

Sheet StrengthやGlow Widthが0でも膜による歩幅の計算は残るため、発光球の描画もFold Frequency・Fold Amount・Sheet Tilt・Maximum Stepsの影響を受ける。Orb Colorのノード入力は画面座標で一度参照し、その画素のレイ全体へ適用する。3Dの材質テクスチャではない。入力の解像度は出力の自動解像度へ使わない。

Color Rampはレイの各地点で評価してから光を加算する。膜の奥行きによって異なる色が混ざり、完成画像の明るさへ後から色を割り当てる処理とは異なる。参照位置は`(レイのZ * 0.2 + 流動後のX * 0.05) * Color Frequency - Color Phase`の小数部分で、0〜1を繰り返す。継ぎ目を滑らかにしたい場合は0と1に同じ色を置く。Color Frequency=0では`fract(-Color Phase)`の色になる。

Rampの補間には共通のColor Ramp実装を使い、補間後の乗算済みlinear RGBを発光量として加算する。stopのalphaはその色の発光量を減らし、出力の被覆率は変えない。HDR・負値も加算途中で保持する。単一stopなら単色、全stopのalpha=0なら膜は発光しない。CosineモードではRampの配色設定は描画へ影響しない。stop数や補間方式によって、各地点の配色を求める計算量も変わる。

発光球の光量は`Orb Color * Orb Strength`で指定し、膜と発光球の合計光量を二乗してコントラストを付ける。そのため最終色はピッカーの色と必ずしも一致せず、Strengthを2倍にしても最終光量が2倍になるとは限らない。負の色成分は加算途中で保持し、合計の二乗によって出力は非負になる。光量を線形に調整したい場合はExposureを使う。

出力はlinear sRGB・rgba16float。エフェクト内ではガンマ変換を行わず、表示側でsRGB encodeする。Soft Shoulderの出力は0〜1へ収束し、HDRは1を超える値を保持する。保存形式の有限上限65504だけで制限する。

Emissionは通常のsource-overでも背景へ光を加えられる。膜の透過率を表すalphaやSDF・深度の出力は持たない。通常の色パラメータのalpha=0は発光量0だが、接続された画像が既に持つalpha=0の発光RGBは保持する。

数値パラメータの非有限値・f32で表せない値は既定値へ戻す。Zoomは0.01〜100、Fold Frequencyは0.01〜16、Fold Amountは0〜16、Sheet Tiltの各成分は±16、Glow WidthとColor Frequencyは0〜100、両Strengthは0〜1000、Exposureは±20へ制限する。Maximum Stepsは1〜120へ制限して整数に丸める。RotationとColor Phaseは1周で折り返す。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/gyroid-glow.gpu.test.mjs`で実際のWebGPUによる検証を実行する。任意で`GYROID_GLOW_PREVIEW`へPNGの保存先を指定すると初期設定の描画を保存する。`GYROID_GLOW_VARIATIONS_PREVIEW`には配色・形状を比較する4枚の作例の保存先を指定できる。
