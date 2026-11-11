# UIフォント

Web版・Electron版ともに、`style.scss`から`bundled.css`を読み込み、同梱フォントを使用する。Google Fontsへの通信やOSへのインストールは不要。フォント本体はViteが参照先のアセットとしてWeb版の`dist/assets/`、Electron版の`dist-electron/assets/`へ出力し、それぞれの配信パスに合わせてCSSのURLを解決する。Electron版ではdesktopの既存の`extraResources`設定がUIと一緒に配布する。

Chivo Monoの通常体・斜体の可変フォントを収録し、100–900のウェイトを使用できる。Google Fontsの公式リポジトリから取得したTTFを、ファイル名だけ変更して同梱する。変換や文字のサブセット化は行わない。

| フォント | 取得元 | 同梱ファイル | ライセンス本文 |
| --- | --- | --- | --- |
| Chivo Mono | [google/fonts（3dd78844021e948ceb633d1dcee3f7885561b5d9）](https://github.com/google/fonts/tree/3dd78844021e948ceb633d1dcee3f7885561b5d9/ofl/chivomono) | `ChivoMono[wght].ttf` → `chivo-mono-normal.ttf`、`ChivoMono-Italic[wght].ttf` → `chivo-mono-italic.ttf` | [`public/licenses/chivo-mono.txt`](../../public/licenses/chivo-mono.txt) |

ライセンスはSIL Open Font License 1.1。著作権表示を含む原文を`public/licenses/`に置き、ビルド時に配布物の`licenses/`へコピーする。フォントを更新するときは、通常体・斜体・ライセンス本文と取得元のコミットを一緒に更新する。
