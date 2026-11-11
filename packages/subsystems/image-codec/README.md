# Image Codec

画像形式のエンコード・デコードを所有する独立したsubsystem。GPU、Canvas、Asset、Scene、プロジェクト、保存先を知りません。TinyEXR/WASMによるOpenEXRとlibwebp/WASMによるWebPの書き出しを提供します。読み込み対応は今後追加します。

## WebP

`WebpEncoder.create({ width, height, lossless, quality })`で作成し、上から順に`writeBlock()`へ未乗算の8bit sRGB RGBAを渡します。`rowsPerBlock`は最大256行・約1MiBで、最終ブロックだけ残りの行数です。WASM内の所有ARGB画像へブロック単位で変換するため、画像全体のRGBA入力やC++の`std::string`を別に保持しません。透明画素のRGBも`exact=1`で保持します。

`encode(async (chunk, completedBytes, totalBytes) => { ... })`は最大1MiBの出力を渡し、writerのPromiseが解決してから次へ進みます。`chunk`は呼び出し中だけ有効なWASMの借用viewです。後で保持したりWorkerでtransferしたりする場合は、writer側でそのチャンクだけコピーします。ファイル全体の`WebPMemoryWriter`やJavaScriptの連続した出力配列を作りません。ただしlibwebp自身が圧縮中に保持するbitstream・解析用バッファは残ります。保存先の知識はwriterを渡す呼び出し側が所有します。

WASM32のheapは最大4GiBまで成長します。Memory64は使いません。同期のlibwebpから非同期writerを待つためJSPIを使用し、Chrome 137以降を対象とします。作成したWorker内で実行し、中断時はWorkerごと終了して確保済みのheapを回収します。`encode()`は成功・失敗のどちらでもnative資源を解放し、圧縮前の失敗では`dispose()`を呼びます。保存失敗は元の例外を返し、libwebpのメモリ不足は4GiBの上限を含むエラーとして返します。

各辺の形式上限は16383pxです。実際に扱える画像は内容と利用可能なメモリに依存します。16383角の単色画像は検証していますが、グラデーションなどでも4GiBを超える場合があります。

## OpenEXR

`OpenExrEncoder.create()`でHALF RGBAのscanline encoderを作成し、上から順に`writeBlock()`へ画素を渡します。ZIPは16行、無圧縮は1行で、最終ブロックだけ残りの行数です。画素は未変換のhalfビット列（`Uint16Array`）、乗算済みlinear sRGBです。RGBのHDR・負値・alpha=0の発光を保持し、`chromaticities`と`colorInteropID=lin_rec709_scene`を記録します。

`finish()`は独立した`ArrayBuffer`を返してnative資源を解放します。中断・失敗時は`dispose()`を呼びます。ブロックごとにJSへ戻るため、呼び出し側がGPU読み戻し・進捗・中断を管理できます。WASMのheapは成長し得るので、そのviewを呼び出し間で保持しません。実行は呼び出し側のWorkerで行い、Worker終了時にWASMメモリ全体も回収します。

寸法はOpenEXRのwindow座標に合わせて正の符号付き32bit整数を受け付け、描画側の寸法制限は呼び出し側が扱います。8192pxの固定上限とTinyEXR既定の1GiBファイル制限は設けず、16K HALF RGBAの無圧縮出力も扱えるようWASM heapは最大4GiBまで成長を許可します。ブロック単位の画素制限は維持します。出力は1MiB単位のchunkに保持し、巨大な連続領域の再確保による一時的なメモリ倍増を避けます。offset tableは同じchunkへ書き戻し、`finish()`でJSの連続した`ArrayBuffer`へコピーします。ファイル全体はWASMとJSに一時的に存在するため、実際の出力サイズは利用可能なメモリにも依存します。

## WASMの再ビルド

通常のアプリビルドには、登録済みの`src/codec/tinyexr.mjs`と`tinyexr.wasm`を使用します。コーデック変更時だけEmscriptenを使って`pnpm --dir packages/subsystems/image-codec build:codec`を実行します。今回の生成物はEmscripten 7.0.0でビルドしました。

WebPは`pnpm --dir packages/subsystems/image-codec build:webp`で`src/codec/webp.mjs`と`webp.wasm`を生成します。libwebp v1.6.0の`4fa21912338357f89e4fd51cf2368325b59e9bd9`へ固定し、`native/build-webp.mjs`が`.build.local/libwebp`へ取得します。同じcommitの既存checkoutは`LIBWEBP_SOURCE`で指定できます。Emscripten 7.0.0、SIMD128・WASM32・JSPIでビルドしています。通常のアプリビルドでSDKは不要です。

TinyEXRは`d8a16915fce4efb562758e90b39c5ca6ddf42abf`へ固定しています。ビルドスクリプトが`.build.local`へ取得します。`TINYEXR_SOURCE`で同じcommitの既存checkoutを指定することもできます。Windowsでは`EMCC`に`emcc.py`の絶対パスを指定します。`PYTHON`は任意のPython実行ファイル指定です。

`native/openexr.c`がブロック単位の薄いバインディングです。色変換や画像の表示処理は持ちません。今後の読み込みは同じTinyEXRのreader APIへバインディングを追加できます。現在のWASMは未使用のreaderとcodecをリンク時に除去しており、読み込みAPIはまだ公開していません。

TinyEXRのBSD 3-Clauseライセンスを`src/codec/LICENSE.tinyexr.txt`に含めています。配布用UIにも`public/licenses/tinyexr.txt`を同梱します。TinyEXR更新時は両方のライセンスを同期してください。

libwebpのBSD 3-Clauseライセンスと追加特許許諾を`src/codec/LICENSE.libwebp.txt`とUIの`public/licenses/libwebp.txt`へビルドスクリプトが同期します。

## 検証

`pnpm --dir packages/subsystems/image-codec test`は実WASMを使い、独立したEXR/ZIP読み取り処理でhalfビット列・チャンネル順・末尾ブロック・メタデータを照合します。UIの`openexr-export.browser.test.mjs`は`CHROME_PATH`指定時に配布形式のWorkerとWASMをChromeで実行します。`EXR_OUTPUT_DIRECTORY`も指定すると生成ファイルを保存でき、公式OpenEXRなどの外部デコーダーで検証できます。

ブラウザテストは対応GPUで8192pxを超える各軸の寸法上限までEXRとWebPを保存し、出力の寸法を読み返します。`LARGE_STILL_EXPORT_TEST=1`も指定すると9000×9000のEXR・WebP書き出しを追加します。この追加検証は数GiBのVRAMを使用します。

コーデックのテストに`LARGE_OPENEXR_CODEC_TEST=1`を指定すると、16384×16384の無圧縮EXRを実際に生成し、2GiBを超えるファイル長と最終scanlineを検証します。この追加検証は数GiBのRAMを使用します。

WebPのテストは別実装のデコーダーでRGBAを照合し、非同期writerの完了待ち、保存失敗、入力不備、配布WASMの4GiB宣言も検証します。`LARGE_WEBP_CODEC_TEST=1`で16383×16383の画像をブロック入力し、復号後の全画素のハッシュを照合します。この追加検証は数GiBのRAMを使用します。
