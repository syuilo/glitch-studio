# Object tracker

[ShadersのObjectTracker](https://shaders.com/docs/components/objecttracker)を移植した画像加工エフェクト。入力の上に物体検出風の枠とラベルを重ねる。意味的な物体認識や時間方向の追跡は行わず、各フレームを独立に解析する。

- `alpha`は不透明度、`bright` / `dark`は非乗算RGBの輝度、`red` / `green` / `blue`は指定チャンネルの強度と優位性で判定する。透明な画素は色の検出対象から除く。
- `grid`は等間隔、`quadtree`は3×3サンプルの検出率に応じた分割、`mosaic`はセル座標と深さから決まる分割。最大5段階まで細分化する。
- 各末端セルを4×4サンプルで解析し、検出点の範囲を囲む枠を描く。小さな領域はサンプル点に当たらず検出されない場合がある。
- `dimensions`は描画解像度での枠の幅と高さ、`percentage`は末端セルのサンプル中の検出率を表示する。
- セルサイズ・枠の線幅・角丸は1080px高さを基準に拡縮する。フォントサイズは描画先の高さの比率、文字間隔はem単位。ラベルは選択した隅へ配置し、セル内に収める。
- ラベル有効時にGoogle Fontsから指定フォントを読み込む。WorkerのFontFaceSetとOffscreenCanvasで数字・記号のアトラスを作り、DOMには依存しない。読み込み中や取得失敗時はmonospaceを使う。ラベル無効時はフォントを取得しない。

定義と実装は既存のエフェクト登録globで自動登録される。入力・出力ともGlitch Studioのpremultiplied alphaに従う。

移植元: [ObjectTracker/index.ts](https://github.com/shader-effects-inc/shaders/blob/main/packages/core/src/shaders/ObjectTracker/index.ts)、[std/effects/overlay.ts](https://github.com/shader-effects-inc/shaders/blob/main/packages/core/src/std/effects/overlay.ts)、[gpu/kit/overlayParts.ts](https://github.com/shader-effects-inc/shaders/blob/main/packages/core/src/gpu/kit/overlayParts.ts)。移植元のMITライセンスをLICENSEに同梱する。
