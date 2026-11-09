# 2D Geometric Optics

SDFで配置した鏡・透明物体・遮蔽物に光を当て、平面内を進む光路を画像として生成する。レンズの集光、プリズムの分散、複数の鏡による多重反射などに使う。光路は光量を持つ線として可視化するもので、3D空間の散乱や受光面の照度を計算するものではない。

## 使い方

1. Objectsへ要素を追加し、そのSDFへShape SDF・SDF Boolean・Mask to SDFなどのscalar出力を接続する。
2. 透明物体はDielectric、鏡はMirror、遮蔽物はAbsorberを選ぶ。形状は各入力SDFで配置・変形し、同じ材質の複合形状は上流のSDF Booleanでまとめる。
3. Sourcesへ光源を追加し、位置・方向・光量を設定する。初期状態は左から右へ進む白色のParallel Beam一つで、Objectsは空。
4. Light Paths出力を発光合成で重ねる。物体の塗り・輪郭は同じSDFをSDF to Maskへ接続して描く。Bloomも後段の既存ノードで加える。

位置・距離は長辺全体=1、中央原点、右が+X、上が+Yの共通単位。方向は右が0、下が0.25、時計回りのturn単位。幅や線幅も共通単位で指定し、Size Referenceによる換算は行わない。

## 物体

Objectsは構造体の配列で、SDF以外は物体ごとに一様な設定。式・キー・automationによる変更に対応する。

| 設定 | 初期値 | 意味 |
| --- | --- | --- |
| SDF | 65504（空形状） | 内側が負、境界0、外側が正の共通単位の距離場。ノード接続可 |
| Material | Dielectric | Dielectric・Mirror・Absorber |
| IOR (550 nm) | 1.5 | Dielectricの基準屈折率 |
| Dispersion | 0 | CauchyモデルのB係数（µm²）。正なら短波長の屈折率が高い |
| Mirror Reflectivity | 1 | Mirrorで反射して残る光量の割合 |
| Red / Green / Blue Absorption | 各0 | Dielectric内部の650 / 550 / 450 nmの吸収係数。単位は共通距離の逆数 |

Dielectricの境界でSnellの法則による屈折と、非偏光のFresnel反射率による反射・透過の分岐を計算する。全反射では反射のみ。レンズとプリズムは独立した材質でなく、Dielectricの形状として表す。

波長をµmで表すと、屈折率は`n(λ) = IOR + Dispersion * (1 / λ² - 1 / 0.55²)`。結果は1〜10に制限する。外部媒質のIORは波長によらず一定。

吸収係数は450 / 550 / 650 nmの値を区分線形で補間し、その外側は端の値を使う。距離dを進んだ光量を`exp(-係数*d)`倍する。例えば3係数をすべて2にすると、共通距離0.5を進んだ光量が`exp(-1)`倍になる。赤を通す材質はRed Absorptionを小さく、Green / Blue Absorptionを大きくする。減衰は境界だけでなく、内部の線分の描画位置でも評価する。

**異なる物体の重なり・入れ子・接触は非対応。** 物体同士は間隔を空ける。同じ材質の形状をつなぐ場合は一つのSDFへ合成する。光源がDielectricの内部にある場合は始点の内外判定から媒質を決める。Mirror・Absorberの内部にある光源は発光しない。境界そのものへ光源を置いた結果は数値精度に依存する。

## 光源

| 設定 | 初期値 | 意味 |
| --- | --- | --- |
| Type | Parallel Beam | Single Ray・Parallel Beam・Point Source |
| Position | [-0.4, 0] | 光線の始点、またはParallel Beamの発光線分の中心 |
| Direction | 0 | 進行方向、またはPoint Sourceの放射角度の中心 |
| Beam Width | 0.2 | Parallel Beamの進行方向に垂直な発光線分の全幅 |
| Point Source Spread | 1 | Point Sourceの全放射角度。1で全方向、0.25で90度 |
| Power | 1 | 光源全体の総パワー。任意単位 |
| Spectrum | White | Whiteは固定の等エネルギースペクトル、Monochromaticは指定波長の単色光 |
| Wavelength | 550 nm | Monochromaticの波長 |

Parallel Beamは発光線分を、Point Sourceは放射角度を等間隔の中点でサンプリングする。Single RayはRay Samplesによらず一本だが、Whiteの場合は波長ごとに経路を追跡する。Beam Widthと描画用のLine Widthは独立し、Line Widthを変えても光学的な経路は変わらない。

Whiteは共通の`optics/spectral-samples.ts`の380〜780 nm・81点の等色応答を区間ごとに合算し、各区間の中央波長を代表として追跡する。Wavelength Samplesを変更しても、分散・吸収がなければRGB合計が白になる。少数点では分散が色の帯に分かれるため、滑らかにするには点数を増やす。Monochromaticの等色応答は81点から線形補間し、RGB色域外の負成分も保持する。任意RGBの分光分布の復元は行わない。

## 全体・品質設定

| 設定 | 初期値 | 意味 |
| --- | --- | --- |
| Exterior IOR | 1 | すべての物体の外部媒質の屈折率 |
| Ray Samples | 128 | Parallel Beam・Point Sourceそれぞれの空間／角度サンプル数。1〜2048 |
| Wavelength Samples | 9 | White光源ごとの代表波長数。1〜81 |
| Max Interactions | 12 | 各経路の反射・屈折回数。0〜32。上限回数の相互作用後も次の境界／画面端までは描画する |
| Minimum Relative Power | 0.001 | 各一次光線の初期パワーに対して弱くなった枝を打ち切る閾値 |
| Path Budget | 65536 | 全一次光線を合わせた線分保存数の上限。最大262144 |
| Maximum Trace Step | 0.005 | 一回の境界探索で進む最大距離。小さくすると薄い形状を捉えやすくなる |
| Maximum Trace Steps | 2048 | 一つの線分の境界探索の反復上限。最大8192 |
| Line Width | 0.003 | 光路の描画幅。0なら透明出力 |
| Exposure | -2 EV | 出力の光量に`2^Exposure`を掛ける |

各光源の総パワーをRay Samplesと分光重みで分配するため、品質を上げるだけで光量が増えることはない。描画線も幅方向の積分を正規化する。1画素未満の線は1画素相当の幅でAA描画する。

Path Budgetは一次光線へ等分し、余りは配列・空間サンプル・波長の順に一つずつ割り当てる。各一次光線の中では強い枝を先に進む深さ優先探索で、反射・透過の両方を追跡する。予算で省いた光を残りへ再配分しないため、予算不足では弱い枝などが欠ける。全一次光線に最低一線分を割り当てられない場合は、光源を黙って削除せずエラーを報告する。

## 出力・精度・実行

- Light Pathsは透明背景の乗算済みRGBA。画像形式はデータ精度の設定と独立したrgba16floatで、RGBはHDR・負成分を保持し、有限範囲±65504で制限する。alphaは露出適用後の非負の光路パワー密度から`1-exp(-密度)`で求める合成用の不透明度であり、材質の透過率ではない。
- 光源・経路・分岐の順序は固定し、浮動小数点atomic加算やフレーム間蓄積を使わない。同じ入力と設定から描画履歴に依存しない結果を得る。
- 光路はCompute Shaderで32bit floatのbufferへ保存し、線分を固定順のインスタンスとして加算描画する。16bitの加算途中のoverflowを防ぐため全体を保守的な倍率で縮小し、最後に倍率を戻す。非常に強い光と弱い光の混在は16bitの丸め・underflowの影響を受ける。
- SDFのFit／Filter／Wrapを使う。Transparentは距離0へ補間せず、clampで延長した距離場と入力領域の矩形との共通部分を取る。空形状65504は矩形へ変化させない。法線の差分幅は入力・出力画素の大きい方を使う。
- SDFの絶対距離を使って歩幅を抑え、Maximum Trace Stepも上限にする。符号が変わった区間は二分探索で精密化する。Boolean・変形後の場が厳密な距離場であるとは仮定しないが、最大歩幅より薄い形状や鋭い角を常に正確に検出する保証はない。必要に応じて歩幅を小さくし、反復数とSDF解像度を上げる。
- 反復数を使い切った場合は到達位置で打ち切り、未確認の区間を空間として描画しない。法線が求まらない境界もそこで打ち切る。
- 追跡する範囲は描画領域内。画面外の光源から領域へ入る光は扱うが、退出後の物体や再入射は扱わない。入力のRepeatはSDFの参照に作用し、光路を画面内へ周回させる設定ではない。
- 自動解像度はObjects配下のSDF接続の最大画素数を使い、接続がなければ描画先を使う。SDFのfitによる距離補正・再距離変換は行わない。
- 光源数・光線数・波長数・分岐数・物体数・探索精度を増やすほど負荷が増える。buffer・dispatch・テクスチャbindingのGPU上限を超えた場合は、品質を黙って下げずエラーにする。各線分は48bytesのbufferを使う。
- 表面は滑らかな鏡面。粗さによる散乱、偏光、回折、干渉、流体・物体の運動、3D光学系、理想薄レンズの近軸モデルは含まない。形や動きは上流とパラメータの式・キー・automationで作る。

数値パラメータの非有限値は既定値へ戻す。物体のIORとExterior IORは1〜10、Dispersionは0〜0.1、反射率は0〜1、吸収係数は0〜1000、光源のパワーは0〜10000、波長は380〜780 nm、幅は0〜10、放射角度は0〜1に制限する。位置は±1000000、Maximum Trace Stepは0.000001〜1、Line Widthは0〜1、Exposureは±20に制限する。整数設定は丸めて上記の範囲へ制限し、Maximum Trace StepsとPath Budgetの最小値は1。

## 作例

- **両凸レンズ**: Shape SDFの円を二つ用意し、中心を[-0.12,0]と[0.12,0]、Sizeをどちらも[0.46,0.46]にする。SDF BooleanのIntersectionをObjectsのDielectricへ接続する。IOR=1.5、左から幅0.16〜0.2のParallel Beamを当てる。実際の形状から追跡するため、太い光束では球面収差も生じる。
- **プリズム**: 三角形のマスクをMask to SDFへ接続し、DielectricのSDFにする。WhiteのSingle Rayまたは細いParallel Beamを当て、Dispersion=0.01〜0.03程度から調整する。色の帯が粗い場合はWavelength Samplesを27以上へ増やす。
- **多重反射**: y=±0.15に薄い横長矩形のSDFを置き、それぞれMirrorにする。Single Rayの位置を[-0.35,0]、Directionを-0.125（右上45度）にし、Max Interactionsを増やす。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/geometric-optics-2d*.test.mjs`で実際のWebGPUを含む検証を実行する。任意で`GEOMETRIC_OPTICS_PREVIEW`へPNGの保存先を指定すると、レンズ・プリズム・多重反射の描画を並べた確認画像を保存する。

参考: [PBRT: Specular Reflection and Transmission](https://www.pbr-book.org/4ed/Reflection_Models/Specular_Reflection_and_Transmission)、[Ray Optics Simulation](https://phydemo.app/ray-optics/)。
