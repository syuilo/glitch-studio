# Web版の配信と計測精度

Web版・Electron版とも、Cross-Origin Isolationを有効にして`performance.now()`の時間分解能を高めます。Chromeでは通常の100µsから5µsへ丸めが緩和されます。丸めの完全な解除ではなく、実測の精度にはOSや実行環境も影響します。

## 開発・プレビュー

`pnpm dev`、`pnpm preview`、`pnpm dev:desktop`では、UIのVite設定が次のレスポンスヘッダーを付けます。HTMLだけでなくWorkerのスクリプトにもCOEPが必要です。

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

HTTPSまたは`http://localhost`・`http://127.0.0.1`などのsecure contextとして扱われるURLでアクセスしてください。開発サーバーをLAN内の通常のHTTPアドレスで開いても、同じ条件にはなりません。

## 公開Web版

Viteの`server.headers`と`preview.headers`は、ビルド成果物にレスポンスヘッダーを埋め込む設定ではありません。公開先のCDN・リバースプロキシ・HTTPサーバーで上記のヘッダーを設定してください。

現在の`.github/workflows/deploy.yml`はGitHub Pagesへ配信します。GitHub Pages自体にはこれらのヘッダーを設定できないため、このWorkflowだけでは公開Web版の計測精度は変わりません。公開版への適用は、独自ドメインの前段に置くCDNなどでレスポンスヘッダーを追加して行います。Service Workerによる書き換えは行いません。

CDNでは、アプリのHTMLとWorkerを含む静的ファイルの配信パス（現在は`/glitch-studio/`以下）に対し、両方のレスポンスヘッダーを追加・上書きします。別途配信している`/glitch-studio/docs/`のユーザーガイドに適用する必要はありません。キャッシュ済みのレスポンスにも反映されるよう、CDNのルール適用順やキャッシュの更新を確認してください。

Nginxの場合は、既存のアプリ用`location`の配信設定に次の指定を追加できます。

```nginx
add_header Cross-Origin-Opener-Policy same-origin always;
add_header Cross-Origin-Embedder-Policy require-corp always;
```

ヘッダーを設定した後は、DevToolsのNetworkでHTMLと実際のWorkerスクリプトのレスポンスを確認します。さらにWindowと計測するWorkerの両方で`self.crossOriginIsolated === true`になることを確認してください。Windowだけの確認では、Workerのヘッダー漏れを検出できません。

## 素材の読み込みと別ウィンドウ

COEPの下では、別オリジンの素材を通常のHTTP(S)で配信する場合、読み込み方法に応じた許可が必要です。

- `fetch()`や`crossorigin="anonymous"`付きの画像・動画はCORSを使用します。配信元の`Access-Control-Allow-Origin`も必要です。
- CORSを使わない画像・動画などの埋め込みは、配信元の`Cross-Origin-Resource-Policy`による許可が必要です。CORSヘッダーだけでは読み込み方法は変わりません。
- 同じオリジンの静的ファイルや、アプリ内で作ったBlobの読み込みには、外部配信元の許可は不要です。

Electronの外部参照素材は`app://external-assets/`で配信し、既存のCORS設定で実際のUIオリジンだけを許可します。画像サムネイルの先読み・表示にも`anonymous`を指定し、動画や`fetch()`と同じCORS経路を使用します。Rangeレスポンスやストリーム配信を維持し、素材全体を読み込んでからヘッダーを付ける処理は追加しません。

COOPは別オリジンのウィンドウとの参照関係にも影響します。現在の切り離しプレビューは、親のオリジン・ポリシーを引き継ぐ空の`about:blank`へDOMを移します。別URLへ遷移する方式に変更する場合は、親からのDOMアクセスを維持できるか再確認してください。

## GPUの計測

Cross-Origin Isolationは、WebGPUのtimestamp queryの量子化を解除しません。Electron版ではmainプロセスの起動時に`enable-webgpu-developer-features`を指定して量子化を解除します。時間の単位や既存の`timestamp-query`の要求方法は変えず、GPU・ドライバーが提供する分解能で計測します。Web版での解除には、ユーザー自身によるブラウザーの開発者向け設定が別途必要です。

## 検証

`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/external-assets-electron.test.mjs`を実行すると、非表示のElectronで配布用`app://`・Vite開発・Viteプレビューの3経路を検証します。WindowとWorkerの隔離、外部参照動画のRange読み込みとデコード、画像のCORS読み込み、別ウィンドウでのCanvas描画を確認します。

仕様の背景は[Chromeのタイマー精度の説明](https://developer.chrome.com/blog/cross-origin-isolated-hr-timers)と[Cross-Origin Isolationの導入ガイド](https://web.dev/articles/coop-coep)を参照してください。
