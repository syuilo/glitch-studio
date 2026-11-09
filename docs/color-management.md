# 色空間と画像の入出力

作業色空間は、sRGBの原色とD65白色点を使うlinear RGBへ固定する。プロジェクト・Scene・Visual Moduleごとの作業色空間設定は持たない。

## 保存値とGPUの規約

- `color`のリテラル・式の戻り値・キーフレーム・Color Rampのstopは、未乗算のlinear sRGB `[R, G, B, A]`。
- 画像のuniform／テクスチャはpremultiplied alphaのlinear sRGB。色の生成境界で一度だけpremultiplyし、接続・バイパス・履歴保存では再変換しない。
- RGBはHDR・負値を許し、途中で一律に0〜1へclampしない。alphaは原則0〜1の被覆率で、伝達関数を適用しない。
- 画像は`INTERMEDIATE_TEXTURE_FORMAT`（`rgba16float`）。データ精度の`enable32bitDataTextures`とは独立している。FLOAT形式のEXRを読み書きできても、内部で失った32bit精度は復元できない。
- scalar・vector・anyや、字形のalphaマスク・LUTの数値表は色変換の対象外。RGBAの4成分があることだけで色として解釈しない。

`src/color-space.ts`はCPUの伝達関数と保存色型、`src/gpu/color-space.wgsl`はGPUの伝達関数とalpha境界を提供する。sRGBの伝達関数は単純なgamma 2.2ではなく、線形区間を持つ規定の式を使い、負値へ符号対称に拡張する。

## 通常の画像・動画の取り込み

画像の埋め込みプロファイルやVideoFrameの色情報に基づき、まずsRGBへ原色・白色点を変換してfloatテクスチャへ取り込む。`createExternalImageToLinearTextureConverter()`が、原寸の各画素でunpremultiply → sRGB伝達関数のdecode → premultiplyを行う。補間・縮小・回転は変換後の画像に対して行う。

Chrome 156では、alpha付きVideoFrameを`srgb-linear`へ直接コピーした場合に、encoded値のpremultiply後に伝達関数を適用する経路があることを実GPUテストで確認している。このため、取り込みは明示的な変換パスを使い、色変換の順序を保証する。変換用の原寸stagingテクスチャは再利用し、画像の初期読み込み完了時・動画の破棄時に解放する。

ImageBitmapの`premultiplyAlpha`は既定値を使う。Chrome 157では`none`を指定すると、半透明の広色域PNGをsRGBへ変換する際に暗くなるため。不透明・半透明のDisplay P3素材を実際の素材読み込み経路へ渡し、linear RGBとalphaを実GPUで検証する。

動画のvisibleRectと表示寸法が異なる場合、表示寸法だけを原寸へ合わせたVideoFrameから取り込む。非正方形ピクセルの拡縮もlinear化より前には行わず、回転・表示寸法・描画倍率を変換済みテクスチャへ適用する。元のサンプルと借用フレームの所有権は変えない。

Playerの映像はGlitch Studioの`PlayerVideoTextures`がフレームと正規化画像を所有する。使用されたPlayerだけをフレーム更新ごとに一度linear化し、複数のVideoノード・Fit変更・ノードの再生成でも同じ原寸画像を借用する。ノードは変換済みテクスチャと表示寸法を受け取り、フレームや共有テクスチャを破棄しない。

通常のPNG・JPEG等をlinear化しても、撮影時のトーン処理や失われたハイライトは復元されない。scene-linear素材との違いは残る。

## UIと色の補間

HEX・sRGB 0〜255・HSL・スポイトはsRGB表記を維持し、保存時にlinearへ変換する。例えば`#808080`の保存RGBは約0.21586。Linear欄は保存値を直接編集でき、HDR・負値を許す。CSS・HEXのSDR見本だけをclampし、ピッカーの開閉・alphaの編集・最近使った色の保存では元のRGBを制限しない。

式の`[0.5, 0.5, 0.5, 1]`はlinearの0.5で、標準sRGB表示では約`#BCBCBC`になる。定義・プリセットをsRGBの数値で記述する場合は`srgbToLinearSrgb()`で明示的に変換してから公開する。既存プロジェクトの旧sRGB数値を変換するマイグレーションは持たない。

Color Rampの新規既定値はLinear補間・Linear sRGB。補間空間にはsRGB・Linear sRGB・Oklab・OKLCHを選べるが、保存stopは常に未乗算linear、評価結果は常に乗算済みlinear。補間後のRGBをclampしない。補間空間の変更で保存色を書き換えない。キーフレームは保存された未乗算linear成分を補間する。

## エフェクトと合成

ブラー・変形・縮小・モーションブラー・通常合成・Screen・Overlay等はlinear上で計算する。知覚的なHSL変換とJPEG・VHS等の信号モデルは、必要な区間だけsRGBへ変換し、出力をlinearへ戻す。

Color AdjustのBrightnessはlinearの光量倍率。Lightness・Contrast・HSLはsRGB上で処理する。HSLを変更する場合だけ、その定義域0〜1へ制限する。光学系の分光積分・光量倍率はlinearで直接計算する。

Apply LUTは入力・出力色空間をそれぞれLinear sRGB／sRGBから指定する（既定は両方Linear sRGB）。`.cube`の拡張子から色空間を推測しない。LUTの数値表自体を色変換・premultiplyせず、表の入出力境界だけを変換する。参照domainへの制限はLUT固有の仕様として維持する。

## alphaが0の発光

画像の`A=0, RGB!=0`は、被覆を持たずに加算される発光成分として保持する。通常のsource-overでも背景alphaによって前景の発光を消さない。光量の乗算・露出・幾何変形・通常合成では、そのままRGBを扱える。

Time PatchworkとDatamoshでも、表示と履歴へこのRGBAをそのまま渡す。alpha=0だけを理由にRGBを消去せず、リセット・遅延・履歴の再生でも発光を保持する。

未乗算を必要とする処理では0除算を避ける。Apply LUTと解析は、この場合のRGBを独立した光の量として扱う。Color Adjust・LCD・閾値・Color Clamp・一部の周波数処理等は、alpha=0の画素を変更せず通す。通常の透明色パラメータは未乗算なので、alpha=0の隠れたRGBから発光を生成しない。

## 表示・SDR書き出し・解析

`CanvasRenderer`は表示直前にだけsRGBへencodeする。露出はlinear RGBへ`2^EV`を乗算する。プレビューの黒背景・チェック背景、不透明出力の黒背景とのsource-overをlinearで済ませ、その後にencode・SDRの範囲制限を行う。チェック背景のアニメーションは表示用に複製した画像を使い、停止中もノード・履歴・解析を再評価しない。

背景の再描画は`PreviewBackgroundScheduler`が通常のフレーム描画から約1/30秒後に予約し、通常描画のたびに予約を延期する。両Managerの`previewActive`をUIの表示モードへ同期し、非表示のプレビューと書き出しではアイドル描画を行わない。CPU表示の背景更新は主Canvasだけを読み戻し、解析画像を再転送しない。通常描画と同じ最大2フレームの待機枠を使う。

背景合成済みの主プレビューと不透明書き出しは、WebGPU Canvasの`alphaMode: 'opaque'`を使う。透明書き出しでは`premultiplied`へ切り替え、元のalphaを保持する。同じalphaModeの間は再configureしない。CSSのプレビュー背景・背景アニメーションは持たない。ヒストグラムの透過描画は引き続き`premultiplied`、波形は`opaque`を使う。

透明なSDR出力では、未乗算へ戻してencodeし、出力先のpremultiplied規約へ戻す。WebPのCanvas 2D読み取りはstraight RGBAを返すため、追加のunpremultiplyをしない。alpha=0の発光を透明なSDR画像へ保持することはできず、不透明な背景合成か将来のEXR出力を使う。

プレビュー露出・表示背景・解析軸は、作業画像・フレームキャッシュ・書き出しへ焼き込まない。自動トーンマッピングは行わない。内部HDRの保持と、HDRモニターへの表示対応は別の機能とする。

ヒストグラムと波形は露出補正前の画像を解析し、共通の軸を選べる。

| 軸 | 範囲 |
| --- | --- |
| sRGB | sRGB表示値の0〜1（既定） |
| Linear | 作業値の−1〜4 |
| EV | −10〜+10 EV、0 EVはlinear 0.18 |

未乗算RGBの分布をalphaで重み付けする。alpha=0の発光は重み1、透明黒は集計しない。範囲外はグラフの端へ集計し、EVで対数を取れない非正値は下端へ寄せる。これは解析表示の範囲制限であり、作業画像の値は変更しない。

## 将来のOpenEXR対応

EXRのデコーダー・エンコーダー・チャンネル選択は未実装。追加時はCanvasや8bit画素を経由せず、linearのfloat画像を読み書きする。入力の`colorInteropID`・chromaticities等に従って作業空間へ変換し、不明な素材の入力色空間を指定できるようにする。データチャンネルには色変換を適用しない。出力は実際の色空間・alpha規約に合うメタデータを付け、入力元のACES等のタグをそのまま引き継がない。
