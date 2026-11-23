# Gyroid Bubbles

3D空間に、近づくと溶け合う発光膜の泡を生成する。輪郭では視線が膜の中を長く通るため明るくなり、中央では手前と奥の膜の光が重なる。入力画像は不要。

| パラメータ | 意味 |
| --- | --- |
| Time | 泡の移動と表面のうねりを進める秒数。18秒で一巡する。式に `TIME` を指定すると再生時刻に追従する |
| Count | 泡の個数。1〜12の整数。初期値は6 |
| Radius | 泡の基準半径。0.02〜0.5の共通単位。泡ごとに基準半径の0.68〜1.13倍で変化を付ける |
| Spacing | 泡の中心間距離の倍率。0〜3で、初期値は1。個数と半径を保ったまま、全体の平均位置を支点に3D配置を広げる・縮める。0ですべての中心が重なる |
| Merge Width | 融合の幅。0〜0.3の共通単位。大きいほど離れた泡の間にも膜がつながり、接合部が丸くなる。0で通常の和集合になる |
| Surface Deformation | うねりの強さ。0で単独の泡は真球。1で陰関数への変形量の上限が基準半径の35%になる |
| Detail Frequency | うねりの細かさ。0.25〜4の倍率。基準半径に対する模様の細かさだけを変える |
| Glow Width | 膜の陰関数上の発光の半幅。0で消灯し、正の値は0.001〜0.1で評価する |
| Glow Strength | 膜の光量の倍率。0で消灯する |
| Camera XY / Camera Z | 固定したワールド空間でのカメラ位置。右が+X、上が+Y、手前が+Z。視線は−Z方向 |
| Zoom / Rotation | 長辺基準の透視投影の拡大率と、時計回りの構図の回転。Rotationは1で1周 |
| Color Mode / Color Ramp | Cosineの周期配色、またはColor Rampによる配色 |
| Color Frequency / Color Phase | ワールド空間に沿った配色の繰り返し頻度・位相。Frequency=0では位相で指定した一色になる |
| Exposure / Tone Mapping | 線形の光量を `2^EV` 倍し、Soft Shoulderでハイライトを圧縮できる。HDRでは圧縮を省く |
| Compositing | Opaqueは黒背景にalpha=1で描画する。Emissionは同じ発光RGBをalpha=0で出力し、背景に光を加える |
| Maximum Steps / Maximum Trace Distance | レイの最大反復数と、カメラからレイに沿った最大描画距離。距離0で消灯する |

ワールド空間は、カメラが `[0, 0, 0.8]`、Zoom=1のときにZ=0の面の長辺全体が1に見える尺度を使う。横長・縦長では短辺方向の見える範囲が狭くなり、泡の形を保つ。既定のZoomは0.78。泡の位置と表面は `Time` の関数で、同じパラメータと時刻へシークすると同じ結果を得る。

球の符号付き距離を順にsmooth unionで合成し、その結果に周期的なgyroidの変形を加える。変形のない2球は、表面の隙間がMerge Widthの半分より小さくなるとつながる。Surface Deformationを上げると、変形した表面が接近する時刻も変わる。画面上の重なりでは、前後の膜がそれぞれ発光する。

レイを泡全体の境界ボックスに切り詰め、場の変化率の上限を使って発光域の手前まで進める。発光域の近くでは一定幅の区間に分け、中央の発光密度に区間長を掛けて積算する。細い膜や強く細かいうねりはより多くの反復を必要とし、反復数を増やすと奥の膜まで届きやすくなる。

Color Rampは各サンプルで評価し、stopのalphaを発光量に一度だけ適用する。出力はlinear sRGBの `rgba16float`。HDRでは負のRGBと1超のRGBを保持し、Soft Shoulderでは符号を保ったまま圧縮する。

`CHROME_PATH` を設定して `node --test packages/subsystems/effect/native-effects/test/gyroid-bubbles.gpu.test.mjs` を実行すると、実際のWebGPUで融合と発光を検証できる。`GYROID_BUBBLES_PREVIEW` に保存先を指定すると、初期設定のPNGも出力する。
