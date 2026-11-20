# Sample Image

Input（color）を、Coordinates（vector）の値が示す絶対座標でサンプリングしてcolorとして出力します。出力位置をpとすると、`output(p) = input(coordinates(p))`です。Vector Displacementのような移動量ではなく、各出力画素が色を取得する位置を指定します。

## 座標とサンプリング

- Coordinatesは描画先の長辺全体を1とする共通座標です。中央は`[0, 0]`、右が+X、上が+Y。正方形の外周は各軸±0.5、横長2:1ならXが±0.5・Yが±0.25です。操作欄の範囲にかかわらず画面外の値も使用できます。
- Coordinatesの定数・式は全画素で同じ参照位置になります。`[0, 0]`なら主入力の中央の色で全体を埋めます。
- Coordinatesの場を出力位置pで読み、その値を内部の画像参照座標へ換算してInputを読みます。両入力のFit・Wrap・Filterは、それぞれ独立して通常どおり適用します。
- 座標はInputの素材固有の座標ではなく、描画先空間での位置です。異なる縦横比の画像では、指定位置に対してInputのFitを適用してからサンプリングします。自動解像度はInputだけから決め、Coordinatesは解像度の算定対象にしません。
- CoordinatesのFitは場の参照位置だけを変え、ベクトル値自体は変換しません。CoordinatesのWrapがTransparentで範囲外の値がゼロになると、Inputの中央を参照します。出力を透明にするマスクとしては扱いません。
- 同じ描画領域のPositionをCoordinatesへ接続すると、通常のInputの表示になります。Positionと描画先の解像度・縦横比を揃えてください。座標場の16bit保存や補間による精度の制約は残ります。

## 使用例

- Position → Vector Math → Coordinatesで、座標の回転・拡縮・折り返しなどを画像へ適用できます。座標の変換は参照位置に作用するため、画像の見た目の動きは逆向きになります。
- Positionへノイズなどの変位場を加算して渡すと、画素ごとに異なる位置から色を取得できます。
- Coordinatesを量子化すると、同じ参照位置を使う領域ごとに色をまとめられます。入力画像の平均色を計算する処理ではありません。

NoiseのCoordinatesによる直接評価と異なり、既に描画された画像を再サンプリングします。画像外の扱いはInputのWrapに従い、拡大時の補間や縮小時のエイリアシングは通常の画像サンプリングと同じです。

## 実行と検証

GPUの1パスで処理し、時刻・描画履歴に依存しません。入力色はpremultiplied alphaのlinear sRGBとしてそのまま返し、負のRGB・HDR・透明度を保持します。画像出力は`rgba16float`です。

`CHROME_PATH`を指定し、`node --test packages/subsystems/effect/native-effects/test/sample-image.gpu.test.mjs`で実際のWebGPU描画を検証します。
