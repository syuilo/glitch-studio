# Cell Transform

入力画像を格子状のセルへ分割し、セル内に表示する内容を移動・拡縮・回転する。描画先のセルの枠は固定される。Frequency・Phase・Angle・Size Referenceで格子を指定し、AdaptiveではDensity Mapに応じて四分割する。

## 参照元の位置

Source Position Modeの既定値はCell Centerで、元のセル中心を参照元の中心とする。Inputへ切り替えると、Per Cell Source Positionのベクトルを参照元の中心として使う。定数なら全セルが同じ領域を参照し、ノードを接続すればセルごとに参照先を指定できる。

座標は描画領域の長辺全体=1、中央が[0, 0]、右が+X、上が+Y。Size Reference・Frequency・Translation Unitで座標の単位は変わらない。主入力のFitを適用する前の描画領域の座標であり、素材固有のUVではない。元画像のセルへのスナップや、一対一の割当は行わず、同じ領域を何度でも使える。

変形がなければ、描画位置p、描画先セルの中心c、副入力から読んだ参照元の中心qに対して、画像の参照位置は`q + (p - c)`になる。参照元の領域は描画先と同じ寸法・向きで、セル内の細部を保って切り出す。セル境界をまたいで副入力が連続していても、各セル内では同じqを使う。

Per Cell Translation・Scale・Rotationは、選んだ領域の内容へ拡縮→時計回りの回転→移動の順で適用する。参照元の中心q自体を回転・拡縮しない。Translation UnitのCellは細分化後のセル幅・高さ、Canvasは長辺全体を移動量1とする。Scaleのどちらかの軸が0付近なら透明になる。

## 制御入力とWrap

Control Samplesは既定値1で、Per Cell Source Positionを含む制御入力を描画先セルの中心で読む。2以上では、セルを等面積領域へ分けた各中心の値を算術平均する。参照元を変更しても制御入力の評価位置は動かさない。座標場自身のFit・Wrap・Filterは、その接続設定に従う。

- Wrap Reference = Cell：選んだ中心の周囲にあるセルサイズの画像片を基準に、変形後の局所座標へWrap Modeを適用する。描画領域外の画像参照は透明になる。
- Wrap Reference = Image：セルサイズでは切り取らず、入力画像全体を参照する。主入力のFit後の画像端にWrap Modeを適用し、Filterは入力接続の設定に従う。定数色のTransparentでは描画領域を画像端として扱う。

副入力で画像内の任意の領域を参照し、画像端も折り返したい場合は、Source Position Mode = Input、Wrap Reference = Image、Wrap Mode = Repeatなどを選ぶ。

主入力だけから自動解像度を決める。座標場にPositionを使って元画像を再現する場合は、描画先と同じ解像度・縦横比に揃え、線形補間でセル中心の座標を読む。座標場の精度や画像端のWrapによって誤差が生じる場合がある。

## 検証

`CHROME_PATH`を指定して`node --test packages/subsystems/effect/shared/test/cell-transform.gpu.test.mjs`を実行する。実際のWebGPUで、定数・テクスチャの参照元座標、セル内の相対位置、座標の単位、拡縮・回転、Adaptive分割、Wrap、透明度・HDR、既存方式への切り替えを確認する。
