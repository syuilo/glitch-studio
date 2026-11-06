# Vector Math

2次元のベクトル場を画素ごとに計算します。A・Bはvector、Scale・Angleはscalarで、それぞれ定数・ノード接続に対応します。初期値はA・Bが`[0, 0]`、Scaleが1、Angleが0、OperationがAddです。Operationは通常パラメータで、式・アニメーションによる切り替えに対応します。

| Operation | 計算・使用する入力 |
| --- | --- |
| Add / Subtract | `A + B` / `A - B` |
| Multiply / Divide (Components) | X/Y成分ごとの乗算・除算 |
| Scale | `A * Scale` |
| Scale and Add | `A * Scale + B` |
| Rotate | 原点の周りでAをAngleだけ回転 |
| Minimum / Maximum | X/Y成分ごとの最小値・最大値 |
| Absolute / Floor / Fract | AのX/Y成分へそれぞれ適用 |
| Sine / Cosine (Turns) | AのX/Y成分をturn単位の角度としてそれぞれ適用 |

RotateのAngleはturn単位で、1で1周、正の値で時計回りです。`[1, 0]`を0.25 turn回すと`[0, -1]`になります。回転は共通単位の数値へ直接適用し、縦横比補正や画像の逆変換は行いません。任意の支点で回転するには支点をSubtractし、Rotateした後で支点をAddします。

Scaleは両成分へ同じ倍率を掛けます。軸ごとに異なる倍率にはMultiplyを使用します。Scale and Addでは変位場をA、Positionの出力をBへ接続すると、1ノードで`Position + Scale * 変位`を作れます。その出力をNoiseのCoordinatesへ接続し、Coordinate SourceをInputにするとドメインワープになります。

Divideは分母が0の成分だけ0を返し、他方の成分は通常通り計算します。Fractは`A - floor(A)`で、負の入力も0以上1未満へ折り返します。値を0〜1に制限したり、alphaとして解釈したりしません。内積にはVector Dot Product、長さにはVector Length、正規化にはNormalize Vectorを使用します。

## 解像度・実行

主入力はAです。自動解像度は選択中の演算にかかわらずA・B・Scale・Angleの全接続から、画素数が最大の入力の寸法を採用します。同数ならA→B→Scale→Angleの順で優先し、すべて定数なら描画先に従います。未使用の接続も静的な算定に含めることで、Operationを変更しても解像度や式の`RESOLUTION`が変わらないようにします。

各入力のfit・wrap・filterを利用します。入力場の位置を変えて再サンプリングするエフェクトではなく、同じ出力位置で読んだ数値を加工します。出力は`enable32bitDataTextures`に従う`rg16float`／`rg32float`です。GPUで1パス描画し、演算別のパイプラインを必要時に作成・キャッシュします。時刻や描画履歴には依存しません。

## 検証

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/shared/test/coordinate-vector.gpu.test.mjs`でPosition・Vector Math・Vector Dot Productを実際のWebGPUで検証します。16bit/32bitの座標値・各演算・0除算・回転方向・スカラー場入力・内積に加え、Positionから加工した座標をNoiseへ接続した結果も確認します。
