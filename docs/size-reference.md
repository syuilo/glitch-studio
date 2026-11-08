# Size Reference

見た目の寸法やパターン間隔を指定する基準を、専用のDataType `{ kind: 'sizeReference' }`で表します。汎用enumとは異なり、共通の選択肢と翻訳済みの編集UIを使用します。既定値はLong Sideです。

| 保存値 | 表示名 | 基準寸法B |
| --- | --- | --- |
| `height` | Height / 高さ | 出力の高さ |
| `width` | Width / 幅 | 出力の幅 |
| `shortSide` | Short Side / 短辺 | 幅と高さの小さい方 |
| `longSide` | Long Side / 長辺 | 幅と高さの大きい方 |

ここでの出力寸法は、そのエフェクトの実際の描画寸法です。ブラウザーやパネルの表示寸法ではありません。縦横とも同じ基準寸法を使用するため、サイズ基準を切り替えても図形や字形を非等方に伸縮しません。

## 数値の意味

- 長さの比率sは`長さ = s × B`としてピクセルへ換算します。
- セル密度Dは`セル幅 = B / D`です。
- パターンの周波数Fは基準寸法Bあたりの周期数です。Checkerは2マスで1周期なので`マス幅 = B / (2 × F)`、Gridは1区間で1周期なので`格子間隔 = B / F`です。

例えば1920×1080、Size=0.1ならHeightとShort Sideは108px、WidthとLong Sideは192pxです。幅と高さを2倍にすると寸法も2倍になり、相対的な見た目を保ちます。TextのSizeはフォントサイズの指定値で、字形の実測高さではありません。

基準を変更したときにパラメータの数値・式・キーを自動変換しません。同じ数値を選択した基準で再解釈するため、基準変更により見た目が変わります。設定・値・公開パラメータの型はプロジェクトに保存し、通常のCommandとUndo/Redoを使用します。

## 適用するパラメータ

画面基準の寸法・間隔を持つエフェクトに適用しています。全てのSize Referenceの既定値をLong Sideに揃えます。

- Text / Text Pattern: フォントサイズのSizeを基準寸法へ換算します。輪郭幅・影・字間・行間などのフォントサイズ比は、換算後のサイズへ追従します。TextのMax Widthは引き続き出力幅の比率です。
- Checker / Grid: パターン用のFit Modeを廃止し、周波数の基準をSize Referenceへ置き換えます。Stretchによる各軸別の基準は使用しません。Frequencyの各成分を異なる値にすると長方形のマスを作れます。Phaseは従来どおり周期単位です。
- Vector Field Visualization: Densityの基準を選択できます。矢印・点・グリッドの太さは引き続きセル幅の比率です。ベクトルとMaximum Magnitudeは共通空間単位、Color Rampはその大きさに従います。Direction Spaceは廃止し、等方的な向きに統一します。

| エフェクト | 基準を適用する設定 |
| --- | --- |
| Stripe、Polkadot、Hex Grid、Cell Transform、Cell Repeater | Frequency。パターン用のFit Modeを廃止。Phaseやセルに対する比率は維持 |
| Cell Sort、Cell Match | Frequencyによるセル寸法。Phaseはセル周期単位 |
| Pixelate、Block Shuffle、Block Shift Glitch、Bit Plane Corruption、Region Time Shift、Color Blocks、LCD、Symbols | Densityによるセル寸法。画像のFit Modeとは独立 |
| Noise、Neuro Noise、Mesh Gradient、Metaballs | DensityまたはScaleによる模様の空間的な大きさ。模様内部の比率は維持 |
| Gradient | 線形勾配の幅・放射状勾配の半径。Start/End Positionは勾配の基準区間に対する値、Centerは共通空間座標。Vector出力は共通座標に対する偏微分 |
| Chromatic Aberration、Vector Chromatic Aberration | 色ずれを計算する等方的な基準領域。入力ベクトルは共通空間単位 |
| Shape SDF | Size・Corner Radius |
| SDF Boolean | Smoothing |
| SDF to Mask | Offset・Stroke Width・Feather |
| Glass | Thickness・Edge Softness・Normal Smoothing・Blur Radius |
| Dilate / Erode、Blur、Pointer Trail、Position Trail | Radius。TrailのVector Coordinatesは廃止し、位置・ベクトル出力を共通単位に統一 |
| Streamlines | Seed Density・Maximum Length・Step Size・Line Width・Arrow Spacing・Arrow Size。大きさによる色と追跡方向の規約は維持 |
| Adaptive Block Glitch、Decoder Corruption、Frequency Transplant、JPEG Compression、JPEG Glitch、Time Patchwork | ブロックの寸法を基準寸法の百分率で指定 |
| Phase Scramble、Phase Transfer | Block Sizeは基準寸法の百分率、周波数とFrequency Softnessは基準寸法あたりの周期数。解析解像度は出力画素数から独立 |
| Datamoshing、Sliding Blocks | ブロック寸法・Motion Search Range。Sliding BlocksのMotion Speed ThresholdとRandom Drift Speedは基準寸法の百分率/秒 |
| Content Error Propagation | Source Spacing・Guidance Radius・Propagation Length。内部解析の解像度は引き続き短辺基準 |
| Multiscale Glitch | Fine Scale・Coarse Scaleによるぼかしのsigma |
| Raster Desync | Raster Densityによる仮想ラスタの間隔 |
| Sine Wave Warp | Frequency・Amplitude |
| Rain Drops on Window 1/2、Water | 水滴のScale、水面模様のDensityと、それらに伴う変位。占有率や屈折強度は相対値を維持 |
| Kaleidoscope | Twist・Radial Repeatで使う半径の単位。Zoomや角度、入力と出力の対応は維持 |
| Tearings | 帯のSize（基準の百分率）とStrength（基準の比率）。帯の中心は出力全体に分布 |
| Quadtree Filter | Min Divisionsによる初期セル寸法、Border Absolute有効時のBorder Width。無効時のBorder Widthはセル比 |
| Zoom Lines | 中央マスクのMask Size。角度方向のFrequency・Density・Outline Thicknessは相対値を維持 |

位置・移動ベクトル・距離・SDFは、Size Referenceにかかわらず「描画領域の長辺全体=1」の[共通単位](spatial-coordinate.md)です。SDF BooleanやSDF to Maskの寸法パラメータは`B / 長辺`倍して距離単位へ換算します。Shape SDFとGlassは内部計算で高さ単位を使いますが、入出力境界で共通単位へ換算します。同じ描画領域であれば、異なるSize Referenceを使うエフェクトへ接続できます。異なる縦横比へFitする際のベクトル・SDFの値の補正は行いません。

入力接続や画像配置のFit Mode、角度・色・時間・拡大率はそれぞれの規約を維持します。TextのMax Widthや出力全体に対する配置・分布など、幅・高さそのものに意味がある設定はその軸を使います。BloomのRadiusは多重解像度のぼかしを混ぜる係数、Liquid MetalのRepetitionは入力形状に沿った模様の反復量で、画面上の長さを直接指定するパラメータではないため対象外です。内部解析の解像度・画素の差分幅・サンプル数にも適用しません。

履歴を持つブロック系では、Size Referenceの変更を格子設定の変更として扱い、以前のブロック状態を破棄します。旧パラメータからのマイグレーションは行いません。

## 型・編集・評価

値の型`SizeReference`、判定、基準寸法の換算は`@gs/shared/size-reference.ts`が所有します。型定義はUIやエフェクトを参照しません。`getSizeReferenceLength()`へ描画寸法を渡し、呼び出し側で比率・周期数を距離へ換算します。

固定値、環境変数、基準式・加工式、Visual ModuleとTimelineの公開パラメータで使用できます。式では`"height"`など上表の文字列を返します。Size ReferenceのキーはHoldで切り替わり、基準間を数値補間しません。テクスチャやInノードのデータ出力には対応しません。
