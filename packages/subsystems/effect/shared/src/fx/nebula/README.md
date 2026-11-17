# Nebula

3Dノイズで生成した雲をレイマーチングし、手前から奥へ発光と吸収を積分する。画像入力を必要としない生成エフェクト。雲の内部へカメラを移動でき、同じ設定・Time・Seedから同じ画像を生成する。

| パラメータ | 意味 |
| --- | --- |
| Time | 流れを進める秒数。式に`TIME`を指定すると再生時刻に追従する |
| Seed | ノイズの配置。描画履歴やフレームごとの乱数には依存しない |
| Camera XY / Camera Z | 固定した3D空間内のカメラ位置 |
| Zoom | 長辺基準の画角の拡大率 |
| Rotation | カメラを中心とする構図の時計回り回転。1で1周 |
| Center XY / Center Z | 雲を含む球の中心。移動すると内部の模様も一緒に動く |
| Radius | 雲を含む球の半径。中心から半径の65%までは一定の包絡、外側35%で滑らかに密度を0へ減らす |
| Density | 発光と吸収の両方へ掛ける密度の倍率 |
| Coverage | 雲量。0で空になり、1では球の包絡だけで密度が決まる |
| Noise Frequency | 共通単位あたりの基準ノイズ周波数。大きいほど細かい構造 |
| Octaves | 重ねるノイズの段数。1〜6。各段で周波数を2倍、重みを半分にする |
| Turbulence | ノイズ座標を別の3Dノイズで歪める強さ。ノイズ座標内の倍率 |
| Flow XY / Flow Z | 内部の模様が進む速度。共通単位/秒で指定し、球の中心は動かさない |
| Color Ramp | 薄い雲から濃い雲への発光色。補間・色空間・繰り返しも共通のRamp仕様に従う |
| Color Offset | Rampの参照位置へ加える値。0〜1の範囲外は端の色に留まる |
| Emission | 発光量。0でも雲の吸収は残る |
| Absorption | 単位密度・単位距離あたりの吸収係数。0では光を吸収せず加算する |
| Exposure | 積分後・トーン処理前のRGBを`2^EV`倍する |
| Tone Mapping | 符号を保つ`sign(C) * (1-exp(-abs(C)))`で光を圧縮。HDRでは圧縮しない |
| Compositing | 吸収率をalphaへ反映。Opaqueではalpha=1、Emissionではalpha=0 |
| Step Size | レイを進める区間の長さ。共通単位で指定する |
| Maximum Steps | 雲の内部で積分する区間数の上限。1〜2048 |
| Maximum Trace Distance | カメラからレイに沿って描画する最大距離。0で空の出力 |

## 座標と時間

右が+X、上が+Y、手前が+Z。カメラの視線は−Z方向。初期カメラ`[0, 0, 0.8]`・Zoom=1・Rotation=0で、Z=0の基準面に見える長辺全体が1になる。正方形の端は各軸±0.5、横長2:1の端はXが±0.5・Yが±0.25。位置・半径・歩幅・描画距離で同じ等方単位を使い、カメラの移動、Zoom、縦横比で単位を変えない。Timelineのカメラとは独立したエフェクト内の空間。

球の中心を原点としたノイズ座標を生成し、速度×Timeだけ模様を移動する。カメラだけを動かしても雲は追従しない。Timeは絶対時刻で、`ctx.time`や`ctx.timeDelta`、前フレームの状態を使用しない。全Flowを0にすると静止する。

SeedはCPU側で決定的なノイズオフセットへ変換する。ノイズは各軸256格子の周期を持ち、流れの位相をCPUで折り返すことで大きな時刻でのf32精度低下を抑える。流体状態を蓄積する処理ではなく、手続き型のノイズ場を移流する。

## 密度・配色・光の積分

重みを正規化した3D value noiseを重ね、雲量に応じたしきい値をsmoothstepで処理して雲の強さ`cloud`を得る。実際の密度は`Density * cloud² * 球の包絡`。Rampは`clamp(cloud + Color Offset, 0, 1)`を各サンプル位置で評価する。球の外縁のフェードとDensityの倍率は配色を変えない。

レイと球の交差から空の区間を飛ばし、各積分区間の中央で密度と発光色を評価する。Step Sizeに対して細かすぎるノイズは欠けたりちらついたりするため、周波数・Octaves・Turbulenceを増やす場合はStep Sizeを小さくして確認する。

区間長を`ds`、密度を`ρ`、吸収係数を`a`とすると透過率は`exp(-ρ*a*ds)`。その区間内を一定密度として、吸収を受ける発光も解析積分する。吸収0では`発光色 * Emission * ρ * ds`へ連続につながる。同じ区間を十分な反復数で描く場合、歩幅を小さくすると積分精度が上がり、サンプル数自体が明るさの倍率にはならない。

Maximum Steps、Maximum Trace Distance、球の出口のいずれかで描画を終了し、最後の区間を境界で切り詰める。Maximum Trace Distanceは球の入口からではなくカメラからの距離で、Z方向の深度ではなく各レイに沿った長さ。Maximum Stepsに先に達すると奥の発光・吸収が欠けるため、Step Sizeを小さくする際には反復数も確保する。

## 色と合成

出力はlinear sRGB・rgba16float。発光の積分値をRGBへ、Volumeでは`1 - 経路全体の透過率`をalphaへ出す。通常のsource-overで背景へ`発光RGB + 透過率 * 背景RGB`を合成できる。RGBへalphaを再乗算しない。吸収0ならVolumeでもalpha=0の発光として扱われる。

Rampのalphaはその色の発光量へ一度だけ乗算する。吸収や出力のalphaには使わないため、全stopのalpha=0やEmission=0でも背景を暗くする雲を作れる。Density=0、Coverage=0、Radius=0、描画距離0ではVolume/Emissionが透明な黒、Opaqueが不透明な黒になる。

Compositingは出力alphaだけを切り替え、雲の内部の吸収と発光RGBは同じ。ExposureとTone Mappingも吸収率を変えない。HDRでは負値と1超を保持し、保存形式の有限範囲±65504だけで制限する。Soft Shoulderは負値の符号も保って圧縮する。ガンマ変換は表示側で行う。

## 入力範囲と検証

描画時の制限は、Camera/Center各成分±1000、Radius 0〜100、Density/Absorption 0〜100、Coverage 0〜1、Zoom 0.01〜100、Noise Frequency 0.01〜64、Octaves 1〜6、Turbulence 0〜16、Flow各成分±10、Color Offset ±1、Emission 0〜1000、Exposure ±20、Step Size 0.0001〜1、Maximum Steps 1〜2048、Maximum Trace Distance 0〜1000、Time ±10億秒。OctavesとMaximum Stepsは整数へ丸め、Rotationは1周で折り返す。スライダーは操作しやすい範囲を表示する。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/nebula.gpu.test.mjs`で実際のWorkerとWebGPUによる検証を実行する。一様な密度での解析解、歩幅を変えた収束、吸収0、HDR・Rampのalpha、合成、カメラと縦横比、Seed・シークの再現性、境界値を確認する。

`NEBULA_PREVIEW`に描画のPNG保存先、`NEBULA_VARIATIONS_PREVIEW`に配色・形状・カメラを比較する4枚のPNG保存先を指定できる。描画例は黒背景へ合成する。
