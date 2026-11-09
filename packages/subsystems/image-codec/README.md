# Image Codec

画像形式のエンコード・デコードを所有する独立したsubsystem。GPU、Canvas、Asset、Scene、プロジェクト、保存先を知りません。現在はTinyEXR/WASMによるOpenEXRの書き出しを提供します。読み込み対応は今後追加します。

`OpenExrEncoder.create()`でHALF RGBAのscanline encoderを作成し、上から順に`writeBlock()`へ画素を渡します。ZIPは16行、無圧縮は1行で、最終ブロックだけ残りの行数です。画素は未変換のhalfビット列（`Uint16Array`）、乗算済みlinear sRGBです。RGBのHDR・負値・alpha=0の発光を保持し、`chromaticities`と`colorInteropID=lin_rec709_scene`を記録します。

`finish()`は独立した`ArrayBuffer`を返してnative資源を解放します。中断・失敗時は`dispose()`を呼びます。ブロックごとにJSへ戻るため、呼び出し側がGPU読み戻し・進捗・中断を管理できます。WASMのheapは成長し得るので、そのviewを呼び出し間で保持しません。実行は呼び出し側のWorkerで行い、Worker終了時にWASMメモリ全体も回収します。

## WASMの再ビルド

通常のアプリビルドには、登録済みの`src/codec/tinyexr.mjs`と`tinyexr.wasm`を使用します。コーデック変更時だけEmscriptenを使って`pnpm --dir packages/subsystems/image-codec build:codec`を実行します。今回の生成物はEmscripten 7.0.0でビルドしました。

TinyEXRは`d8a16915fce4efb562758e90b39c5ca6ddf42abf`へ固定しています。ビルドスクリプトが`.build.local`へ取得します。`TINYEXR_SOURCE`で同じcommitの既存checkoutを指定することもできます。Windowsでは`EMCC`に`emcc.py`の絶対パスを指定します。`PYTHON`は任意のPython実行ファイル指定です。

`native/openexr.c`がブロック単位の薄いバインディングです。色変換や画像の表示処理は持ちません。今後の読み込みは同じTinyEXRのreader APIへバインディングを追加できます。現在のWASMは未使用のreaderとcodecをリンク時に除去しており、読み込みAPIはまだ公開していません。

TinyEXRのBSD 3-Clauseライセンスを`src/codec/LICENSE.tinyexr.txt`に含めています。配布用UIにも`public/licenses/tinyexr.txt`を同梱します。TinyEXR更新時は両方のライセンスを同期してください。

## 検証

`pnpm --dir packages/subsystems/image-codec test`は実WASMを使い、独立したEXR/ZIP読み取り処理でhalfビット列・チャンネル順・末尾ブロック・メタデータを照合します。UIの`openexr-export.browser.test.mjs`は`CHROME_PATH`指定時に配布形式のWorkerとWASMをChromeで実行します。`EXR_OUTPUT_DIRECTORY`も指定すると生成ファイルを保存でき、公式OpenEXRなどの外部デコーダーで検証できます。
