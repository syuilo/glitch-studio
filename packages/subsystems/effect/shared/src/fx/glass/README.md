# Glass

2Dの符号付き距離場を形状として、入力画像にガラスの屈折・ぼかし・色収差・ハイライト・縁の発光・着色を加える。SDFは内側が負、境界0、外側が正で、距離の単位は描画領域の高さを1とする。Shape SDF・Mask to SDF・SDF Booleanの出力を直接接続する。SDF to Maskによる事前変換は不要。

## 入出力・パラメータ

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| Input | 透明 | ガラス越しに参照する画像・色 |
| SDF | 65504 | ガラス形状の距離場。初期値は既存SDFと同じ空形状 |
| Refraction Model | Quadratic | 現行の二次減衰、またはCurvature・IORから計算するCurved Surface |
| Refraction | 1 | 屈折量。輪郭の勾配に沿って内側へ画像の参照位置をずらす |
| Thickness | 0.03 | 両方式に共通する、屈折が及ぶ内側の幅。高さ基準。0以下で屈折なし |
| Curvature | 4 | Curved Surfaceの断面の形。2は円弧状、高い値ほど平らな上面と急な縁になる |
| IOR | 1.5 | Curved Surfaceの屈折率。内側への屈折の減衰を変える。1で屈折なし |
| Edge Softness | 0.0015 | ガラスの被覆率が変化する全幅。高さ基準、境界の両側へ半分ずつ広がる |
| Blur Radius | 0 | ガラス越しの画像をぼかす円盤の半径。高さ基準 |
| Blur Samples | 24 | ぼかし円盤のサンプル数。1〜128。1は円盤中心の1点を読む |
| Aberration | 0.5 | 屈折ベクトルに沿うRGBのずれ。0で無効 |
| Aberration Samples (per Channel) | 1 | RGB各チャンネルあたりのサンプル数。1〜32。初期値1は従来の合計3点 |
| Inner Zoom | 1 | ガラス越しの画像の倍率。1で等倍、最小0.001 |
| Inner Zoom Center | [0, 0] | ズームの支点。画面中央[0, 0]、左下[-1, -1]、右上[1, 1]。形状の位置とは独立 |
| Light Angle | 300/360 | 光の方向。右が0、下が0.25、1で時計回りに1周 |
| Highlight / Color / Softness | 0.05 / 白 / 0.5 | 方向性のある縁と鏡面ハイライトの強さ・色・柔らかさ |
| Fresnel / Color / Softness | 0.1 / 白 / 0.1 | 縁の発光の強さ・色・内側への広がり |
| Tint Color / Intensity | 白 / 0 | 画像に混ぜる色と強さ |
| Tint Preserve Luminosity | true | 着色の前後で輝度を保つ |
| Cutout | false | trueならガラスの外側を透明にし、falseなら元画像を残す |

Input・SDFは定数とノード接続に対応する。その他は画面全体で共通のパラメータで、式・automationを利用できる。形状の種類・位置・寸法・回転は上流のSDFで設定し、このエフェクトでは変形しない。Inner Zoom Centerは画像の参照位置だけを変え、形状や照明を動かさない。

量・幅の負値は0、Inner Zoomは0.001以上、SoftnessとTint Intensityは0〜1として扱う。Curvatureは2〜6、IORは1〜2に制限する。Curvature・IORはQuadraticでは参照しない。色パラメータのalphaは各効果の強さに掛ける。Thicknessは物理的な3Dの厚みではなく、2Dの輪郭付近で屈折を起こす幅である。

Blur Samples・Aberration Samplesは最も近い整数へ丸め、それぞれ1〜128・1〜32に制限する。式・automationで指定する場合も同じ扱いになる。Blur=0ではBlur Samplesを、Aberration=0または変位0ではAberration Samplesを参照せず、不要なサンプルを省略する。

Thicknessはliquidglass.devでのBezelに相当する幅だが、形状の短辺に対する割合ではなく描画領域の高さを基準とする。任意のSDFから形状サイズを推定する処理は行わない。

## 描画

距離の中央差分から高さ基準の勾配を求める。差分幅には入力・出力の大きい方の1画素を使い、nearestや低解像度の入力でも輪郭の向きを得られるようにする。勾配の長さは12以下に制限する。

### 屈折方式

初期値のQuadraticは従来の計算・初期パラメータを維持する。`s = clamp(max(-distance, 0) / Thickness, 0, 1)`として、屈折の減衰係数は`(1 - s)^2`。SDFの勾配にこの係数を掛けるため、厳密なSDFでない場合は勾配の長さも変位量へ影響する。Curvature・IORを変更しても見た目は変わらない。

Curved Surfaceはliquidglass.devの断面モデルを連続評価する。`k = Curvature`として、断面の高さを`h(s) = (1 - (1 - s)^k)^(1/k)`とし、その傾きから入射角`theta`を求める。Snellの法則による角度差を使い、減衰係数は次になる。

```text
thetaT = asin(sin(theta) / IOR)
strength = tan(theta - thetaT) / sqrt(IOR^2 - 1)
```

縁の最大値で正規化し、IOR>1ではRefraction=1の最大変位を高さの0.15倍に保つ。IORは主に内側への減衰を変え、1なら変位0とする。Thickness以上の深さでも変位0。SDFの勾配は単位方向へ正規化して使用する。勾配0なら方向がないため変位も0となる。

縁の傾きは無限大だが変位の極限は有限なので、実装では傾きの分子・分母から角度のsin/cosを求め、三角関数の差を有理化した等価式を評価する。縁・IOR=1・非常に薄いThicknessでも0除算や無限大を生成しない。サイトの512段階の参照表や変位マップへの量子化は行わず、1パス内で直接計算する。

方式の選択は屈折と、その減衰係数を使う鏡面ハイライトの強度へ作用する。形状の被覆率・縁の照明モデル・着色・ぼかし・ズーム支点は共通。色収差は両方式とも変位の`Aberration * 0.06`を赤・青へ逆向きに加える。

### 被覆率・色

境界のAAには`fwidth(distance)`とEdge Softnessの大きい方を使う。幅0の一様な距離場では`distance < 0`で内側を判定する。空形状65504は常に外側とし、Cutoutがfalseなら入力をそのまま返し、trueなら透明にする。

ぼかしにはBlur Samplesで指定した点数のVogel diskとGaussian重みを使い、中間テクスチャを作らずに屈折後の位置で入力をサンプリングする。初期値24では従来の配置を維持する。1では中心を読んでぼかしなしにし、画像が片側へ移動することを避ける。時刻や画素ごとの乱数は使わない。広いぼかしや非常に細かい模様では、有限サンプルによる模様が残る場合がある。

Aberration Samples=1では、従来どおりRGBをそれぞれ1か所で読む。2以上では、その各参照位置を中心に、隣接するチャンネル間の距離と同じ幅の区間を等分し、中点のサンプルを平均する。区間は対称なので各チャンネルの分散の中心は保ち、周囲の細かな模様や透明境界を滑らかにする。1から増やすと点の読み取りから区間の平均へ変わるため、色の広がり方も変わる。

両効果を有効にした場合、ガラス越しの画像の参照回数は`Blur Samples * Aberration Samples * 3`になる。ぼかし無効時の係数は1、色収差無効時の係数も1。初期値では、ぼかしのみ24点、色収差のみ3点、両方あり72点で従来と同じ。両方の点数を増やすと処理量も積に比例する。元画像の参照と距離場の参照は別に必要。

入力画像・出力は乗算済みRGBA。ぼかしはそのまま平均し、着色・照明の前だけRGBをalphaで除算する。色収差では各チャンネルの乗算済み成分とalphaを同じ重みで平均した後、3チャンネルの最大alphaを共通のalphaにする。緑の位置が透明でも赤・青を失わず、サンプル数を増やしても透明境界の被覆率を保つ。照明・着色も屈折後のalpha内に適用するため、完全に透明な画像から光や不透明なガラスは生成しない。Cutoutはガラスの被覆率をRGBA全体へ掛ける。

## 解像度・サンプリング・制約

自動解像度はInputを基準とし、定数なら描画先を使う。SDFは制御用の場なので、自動解像度の基準にしない。出力形式は画像用の`intermediateTextureFormat`に従い、`enable32bitDataTextures`から独立する。

両入力のfit・filter・wrapを利用する。SDFのTransparentだけは0へ混ぜず、端で延長した距離場と入力領域の矩形との共通部分を使う。これによりContainの余白にガラスが現れず、余白の境界も勾配に反映される。画像入力は通常の透明サンプリングを使用する。

距離値のfit倍率補正や再距離化は行わない。入力は同じ距離単位・座標系に揃えることを基本とする。非等方拡縮・Booleanの継ぎ目・Mask to SDFの近似誤差は、屈折やハイライトにも影響する。3Dの厚み場、球体の光学、レイトレーシングは対象に含まない。

## 移植元・検証

[Shader Effects Inc. Glass](https://github.com/shader-effects-inc/shaders/blob/main/packages/core/src/shaders/Glass/index.ts)の[ガラス処理](https://github.com/shader-effects-inc/shaders/blob/main/packages/core/src/gpu/kit/effects/glass.ts)の2D経路を基にした実装。MIT Licenseの著作権・許諾表示を同梱のLICENSEに保持する。

Curved Surfaceの断面・屈折モデルは[gentpan/liquidglass](https://github.com/gentpan/liquidglass/blob/main/lib/liquid-glass.js)の`profileTable`を基にしている。こちらのMIT Licenseの著作権表示もLICENSEに保持する。元サイトの全ての照明・合成を再現するものではない。

Glitch StudioのSDF入力・座標・乗算済みRGBAへ適応し、距離の中央差分、独立したズーム支点、高さ基準の幅とぼかし、解像度に依存しない縁のハイライトへ変更している。元実装のGaussianブラー用事前パスは使わず、Vogel disk方式を採用する。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/glass.gpu.test.mjs`で実際のWebGPU描画を検証する。両方式の参照値・切替・縁の極限・IOR=1・透明度・サンプル数の変更と丸め・既存SDF接続を、16bit/32bitのSDFと画像出力形式の組合せで確認する。
