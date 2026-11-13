# Visual Module Web export

Visual Moduleをエディタから独立したWeb Componentとして配布するGlitch Studio層です。プロジェクトやPlayerの起動を行わず、Visual Module・使用するCustom Shader Effect・参照Assetのスナップショットを受け取ります。

## 構成

- `src/export.ts`: 依存収集・静的検証・素材の埋め込み・HTML/JavaScript/利用案内の生成。収集規則は`.gsvm`と`glitch-studio/shared/visual-module-resources.ts`を共有します。
- `src/archive.ts`: HTML・JavaScript・利用案内を一回でダウンロードする非圧縮ZIPの生成。
- `src/element.ts`: Custom Elementの登録、Shadow DOM、表示サイズ・可視性・時間・ポインター・公開値とWorkerの管理。
- `src/frame-rate-limiter.ts`: 表示周期の端数を持ち越すFPS制限。rAF時刻の丸めによる余分な間引きを防ぎ、失った描画枠は再実行しません。
- `src/worker.ts`: WebGPU・素材・VisualModuleRendererの生成と破棄。既存のエフェクト実装・非同期準備・色変換を使います。
- `src/parameters.ts`: 公開値の検証と既定値の解決。編集用Bindingではなく通常の値をAPI境界で扱います。
- `build/runtime.mjs`: ViteでElementとWorkerをそれぞれ独立したIIFEに束ねます。UIのViteプラグインから呼び出し、成果物内ではビルドや外部importを行いません。

`glitch-studio/ui`は書き出しダイアログと保存を担当します。Visual Module subsystemはこの配布形式・Custom Element・プロジェクトを知りません。描画の表示境界は`glitch-studio/renderer/portable-canvas-renderer.ts`です。

## 成果物

UIのVisual Moduleエディタの「その他」からWeb用の書き出しを選択します。

- HTML + JavaScript: `index.html`、`artwork.js`、`README.md`のZIP。埋め込み先ではJavaScriptとCustom Elementを使用します。
- 単一HTML: JavaScriptと素材を含むHTML。同じページにスクリプトと要素を移して利用するか、HTTPSで配信してiframeでも表示できます。

どちらも画像・動画・フォント・LUTなどの参照Asset原本をBase64で含めます。CDNやエディタへの接続は不要です。元ファイルのパスとデバイス識別子は含めません。初期版は全組み込みエフェクトのランタイムを同梱し、Custom Shader Effectは使用する定義だけを含めます。タグ名は書き出しごとのUUIDを持ち、別作品との登録衝突を避けます。

HTTPSまたはlocalhost上のWebGPU対応Chromeを対象にします。COOP/COEPによるcross-origin isolationは必要ありません。配信先のCSPは成果物のscript、`worker-src blob:`、コンポーネントのインラインstyleを許可する必要があります。単一HTMLはインラインscriptの許可も必要です。式の評価に`unsafe-eval`は使いません。HTML + JavaScriptを`file://`で直接開く使い方は対象外です。

## 公開API

実際のタグ名は生成されたHTML・READMEを参照してください。

```html
<script type="module" src="./artwork.js"></script>
<gs-visual-module-example
  id="artwork"
  style="width: 100%; height: 60vh"
  parameters='{"speed": 0.8}'
></gs-visual-module-example>
```

```js
await customElements.whenDefined('gs-visual-module-example');
const visualModuleElement = document.querySelector('#artwork');
await visualModuleElement.ready;
visualModuleElement.setParameter('speed', 1.2);
visualModuleElement.setParameters({ speed: 0.5, color: [1, 0.2, 0, 1] });
const speed = visualModuleElement.getParameter('speed');
visualModuleElement.resetParameter('speed');
visualModuleElement.pause();
visualModuleElement.play();
visualModuleElement.restart();
```

公開パラメータは`nameForReference`を大小文字を区別して指定します。APIで設定した値、`parameters`属性、書き出し時の初期値、公開定義の既定値の順に優先します。`resetParameter`はAPIの上書きだけを取り消します。属性の削除は属性の上書きをすべて取り消します。既定値は開始時刻で値に変換し、Visual Module Live Previewの引数を暗黙に保存しません。

スカラーは有限の数値、真理値・文字列・enumはそれぞれの値、ベクトルは`[x, y]`、色はstraight linear sRGBの`[r, g, b, a]`です。RGBはHDR値を許し、alphaは0〜1です。配列・構造体は通常のJSON配列・オブジェクトで、編集用IDやBindingを含めません。Color Rampは既存の値形式、`any`はRGBAまたは`null`、音声入力は`null`だけを扱います。外部画像・音声を注入するAPIはありません。

更新は全項目を検証してから一括適用します。不正なAPI入力は例外、属性入力は`error`イベントとなり、直前の有効値を維持します。取得した値や呼び出し元のオブジェクトの変更は内部状態に影響しません。

| 属性 | 既定値・意味 |
| --- | --- |
| `parameters` | `{}`。公開値のJSONオブジェクト |
| `resolution-scale` | 書き出し設定。初期値1 |
| `max-pixels` | 書き出し設定。初期値8,294,400 |
| `fps-limit` | `auto`または正の数値。省略時は書き出し設定。初期値は自動 |
| `paused` | 存在すれば時間を停止。`paused="false"`も停止 |

`currentTime`は秒単位の読み取り専用値です。`ready`は接続ごとのPromiseでGPUと画像の初期化後に解決します。最初の描画完了を保証せず、動画・フォント・シェーダー準備の失敗は後から届く場合があります。

| イベント | detail |
| --- | --- |
| `ready` | 初期化完了 |
| `render` | `{ resolution: { width, height }, time }`。GPU処理完了、timeは秒 |
| `error` | `{ message, fatal }`。fatalなら描画を停止し要素内にも表示 |

## 描画と寿命

- CSSで表示寸法を決めます。高さが未指定の場合だけ、書き出し時のプロジェクトの縦横比をCSSの`aspect-ratio`に使います。固定の出力解像度は保存しません。
- ResizeObserverの物理ピクセル寸法に描画倍率を掛け、最大画素数・GPU上限で縦横比を保って縮小します。ノード自身の`auto`・固定解像度・倍率は保持します。これらによる中間テクスチャの大きさは`max-pixels`の対象外です。
- テクスチャ出力と表示先の縦横比が異なる場合はcontainで表示し、余白は透明です。均一な色の出力は表示領域全体に描きます。作業色空間は既存のlinear sRGB・rgba16floatで、表示時に既存のCanvas出力規約へ変換します。
- 時間は可視状態の経過時間を使い、フレーム数に依存しません。画面外・非表示ページ・0サイズ・`paused`では進めず、復帰時に飛ばしません。停止中もパラメータ・ポインター・サイズ更新は再描画します。
- FPS設定の初期値は「自動」です。内部の`fpsLimit: null`で表し、`requestAnimationFrame`の周期に追加の間引きを行いません。画面のリフレッシュレートが変わった場合も追従します。`fps-limit="auto"`は書き出し時に数値指定した設定も上書きし、属性を削除すると書き出し設定へ戻ります。
- 数値指定のFPS制限は予定時刻の位相を保って間引きます。時刻の丸めに対して最大0.5msを許容し、60Hzで60fpsを指定した場合や表示周期が目標FPSで割り切れない場合も、不必要に描画回数を減らしません。GPU処理が遅れた場合は古い枠を捨て、一度に送るフレームは一つのままです。
- リサイズでエフェクト履歴をリセットし、時間を保持します。`restart()`は時間と履歴をリセットし、致命的エラー後の再初期化も行えます。
- DOMからの削除でObserver・イベント・Worker・GPUリソースを解放します。再接続時はcanvasを作り直し、時刻と公開値を保持して履歴をリセットします。同一Document内の同期的なDOM移動では維持します。
- 一要素につき一Worker・一GPUDeviceです。GPU完了まで次のフレームを送らず、描画が遅い場合のキュー蓄積を防ぎます。
- primary pointerの移動・押下を受け取り、`POINTER_POSITION`へ既存の等方座標規約で渡します。余白の位置も出力座標へ換算し、最後の位置を保持します。タッチのスクロールを妨げず、複数ポインター・筆圧・押下状態の新しい環境変数は追加しません。
- Playerはファイル由来も含めて未接続です。Videoは透明、音声は未入力として既存の処理に渡します。Video Frameは同梱した動画Assetを独立して読み出せます。Timeline・音声出力・タイルレンダリング・パフォーマンス統計は含めません。
- Visual Module内の環境変数は`IS_EXPORT=false`、`END_TIME=Infinity`、`PROGRESS=0`です。

## 検証

`pnpm --filter @gs/glitch-studio_embed test`で素材収集・公開値・解像度・HTML/ZIP生成を検証します。ブラウザ統合テストは`CHROME_PATH`にChromeの実行ファイルを設定して同じコマンドで実行します。実際に生成したファイルをローカルHTTPで配信し、WebGPUの画素・透過・ポインター・再接続・複数要素・単一HTMLを検証します。設定がない場合はブラウザテストだけをskipします。
