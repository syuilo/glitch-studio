# Image Trap

Mandelbrot・Juliaの反復軌道`z → z² + c`から入力画像を参照し、画像片をフラクタル状に繰り返して合成します。
画像・動画・テキスト・ほかの生成エフェクトなど、color出力をInputへ接続できます。未接続時は透明です。

参考: [Ultra FractalのImage Trapと画像取り込み](https://www.ultrafractal.com/download/uf6-manual.pdf#page=134)。
軌道に沿った画像参照を独立したエフェクトとして実装し、ほかのエフェクトの実装へは依存しません。

## 基本的な使い方

1. Image・Video Frame・Textなどのcolor出力をInputへ接続します。透明な背景を持つ文字や図形では画像片の重なりが分かりやすくなります。
2. 初期値のJuliaで、Julia Constantを変更して模様を探します。通常のパラメータなので式・キーフレームでも動かせます。
3. Trap Position・Trap Size・Trap Rotationで、軌道から画像を取り込む領域を調整します。
4. 画像片の重なりはComposite Mode・Sample Opacity・Iteration Decayで調整します。
5. Viewのポインタボタンを有効にすると、プレビューのドラッグで位置、ホイールでカーソルを中心としたズームを調整できます。中心の数値欄と操作パッドも倍率に応じた感度になります。

入力画像はTrap Sizeの矩形へ接続のFit設定で配置します。画像全体を保つにはContain、矩形を埋めるにはCover、矩形へ引き伸ばすにはStretchを使います。
Containの余白を透明にする場合は接続のWrapをTransparentにします。Filterも接続設定に従います。
トラップの矩形自体の外側は、接続のWrapがClamp・Repeatなどでも常に透明です。

## パラメータ

| パラメータ | 初期値 | 意味 |
| --- | --- | --- |
| Input | 透明 | 取り込む画像・動画などのcolor入力。定数色も有限なトラップ矩形として扱います。 |
| Formula | Julia | Juliaは`z0=画面位置, c=Julia Constant`、Mandelbrotは`z0=0, c=画面位置`です。 |
| Julia Constant | [-0.745, 0.186] | Juliaの複素定数。Mandelbrotでは使用しません。 |
| View / Complex Center | [0, 0] | 画面中央に対応する複素平面上の位置。 |
| View / Zoom | 1 | 複素平面の拡大率。最小0.001。 |
| View / Rotation | 0 | フラクタル全体の表示の回転。turn単位で、正値は時計回り。 |
| Coordinate Offset | [0, 0] | 初期座標への変位。共通等方単位のベクトル場も接続でき、Zoom・Rotationより前に加えます。 |
| Trap Position | [0, 0] | 軌道から画像を取り込む矩形の中心。共通等方単位で、+Xが右、+Yが上。 |
| Trap Size | [0.25, 0.25] | トラップの幅・高さ。共通等方単位で、各軸の最小値は0.000001。 |
| Trap Rotation | 0 | 取り込む画像の回転。turn単位で、正値は時計回り。 |
| Composite Mode | First On Top | 反復ごとの画像の重ね方。下記参照。 |
| Sample Opacity | 1 | 各反復で読むサンプルの不透明度。合成後の画像全体の不透明度とは異なります。0〜1。 |
| Iteration Decay | 0.98 | 次の反復のサンプルへ掛ける減衰率。1で減衰なし、0では最初の対象反復だけを描きます。0〜1。 |
| First Iteration | 1 | 画像を参照し始める反復。`z²+c`で更新した後の1から数えます。 |
| Maximum Iterations | 128 | 軌道を計算する最終反復。開始反復からの回数ではありません。 |
| Bailout Radius | 4 | この半径を超えた最終点まで照合してから反復を終了します。2〜1e12。 |
| Antialiasing | Off | 画素内の固定4点で軌道と合成を独立に計算して平均します。 |

反復の指定値は切り捨てて1〜512へ制限します。First IterationがMaximum Iterationsより大きい場合は透明です。
Sample OpacityとIteration Decayも指定範囲へclampします。

## 座標と画像配置

画面位置は中央原点・長辺全体=1の共通等方単位から、Zoom=1で複素平面の長辺全体=4へ換算します。
Complex CenterとJulia Constantは複素数の実部・虚部であり、画面上の距離を表すTrap Position・Trap Sizeとは単位が異なります。

軌道の複素座標を4で割って共通単位へ戻し、Trap Positionを引き、Trap Rotationの逆変換とTrap Sizeによる正規化を経て画像を参照します。
Trap Position・Trap Sizeは表示側のZoom・Rotationには依存しません。
入力のFitはトラップの幅・高さへ適用するので、出力の縦横比を変更しても、同じ設定の矩形と画像配置は歪みません。
自動解像度はInputの接続から取得し、Coordinate Offsetの解像度には従いません。

## 合成と透明度

すべて乗算済みRGBAで処理します。対象反復`n`のサンプルに掛ける重みは、次のとおりです。

```text
Sample Opacity × Iteration Decay^(n − First Iteration)
```

矩形外・画像の透明部分も反復として数えます。First Iterationより前は軌道だけを計算し、減衰は進めません。

- **First On Top**: 早い反復を手前にして、その背後へ後続の画像を合成します。結果が完全不透明になれば早期終了します。
- **Last On Top**: 遅い反復を手前へ重ねます。途中が不透明でも後続の画像で置き換わるので、反復を続けます。
- **Maximum Alpha**: 重みを掛けた後のalphaが最も大きいサンプルを選びます。同じalphaなら早い反復を保持します。

不透明な矩形画像をFirst On Topで使うと、最初に画像へ当たった反復が後続を隠します。透明な素材を使うか、Sample Opacityを下げると重なりが見えます。
AAでは各標本の合成を完了してからRGBAを平均し、透明度を二重に掛けません。

## 発散判定と負荷

Juliaの定数が大きい場合にも戻れる軌道を途中で打ち切らないよう、発散判定半径には`0.5 + sqrt(0.25 + |c|)`という下限を適用します。
f32で二乗がオーバーフローする前にも反復を止め、非有限な参照位置から画像を読みません。

描画履歴・描画間隔・暗黙の時計・乱数には依存せず、現在の入力とパラメータだけで描画します。
ループ内の画像参照は明示LOD 0で行います。細かな反復模様はエイリアスが生じやすく、AAは負荷と引き換えに境界を改善します。
負荷は画素数・反復数・AAに依存します。重い場合はMaximum Iterationsやプレビュー倍率を下げて調整します。
