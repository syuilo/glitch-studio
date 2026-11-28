# Nodes Effect Web export

Nodes Effectをエディタから独立したWeb Componentとして配布するGlitch Studio層です。Native Effect、Custom Shader Effect、入れ子のNodes Effectを `effectSource` から解決し、作品の主カラー出力を描画します。

## 構成

- `src/export.ts`: 依存収集・静的検証・素材の読み出し・HTML/JavaScript/利用案内の生成。収集規則は`.gsne`と`glitch-studio/shared/nodes-effect-resources.ts`を共有します。
- `src/archive.ts`: HTML・JavaScript・利用案内・素材原本をまとめる非圧縮ZIPの生成。
- `src/element.ts`: Custom Elementの登録、Shadow DOM、表示サイズ・可視性・時間・ポインター・公開値とWorkerの管理。
- `src/frame-rate-limiter.ts`: 表示周期の端数を持ち越すFPS制限。rAF時刻の丸めによる余分な間引きを防ぎ、失った描画枠は再実行しません。
- `src/worker.ts`: WebGPU・素材・`effect` の `EffectInstance` の生成と破棄。主出力を指定して描画を準備し、完了したフレームをCanvasへ渡します。
- `src/parameters.ts`: 公開パラメータの参照名と既定値の解決。編集用Bindingではなく通常の値をAPI境界で扱います。
- `src/effect-inputs.ts` は公開パラメータの値をWorker内のEffect入力へ束縛します。
- `src/runtime-requirements.ts`: 検証済みの作品から、配置済みエフェクトと式評価・Custom Shader Effectの必要性を判定します。
- `build/catalog.mjs`: アプリのビルド時に、TS・WGSL・npm依存を解決したES Modulesのカタログを生成します。
- `build/runtime.mjs`: カタログから使用するエフェクトだけをimportし、esbuildでElementとWorkerをそれぞれ独立したIIFEに束ねます。配布先ではビルドや外部importを行いません。

エフェクト内蔵画像はエフェクトのディレクトリ内で所有して静的importし、カタログではData URLへ変換します。Symbolsの記号・数字・絵文字も使用時だけ同梱され、公開パラメータによるアイコンセットの変更に備えて全セットを含めます。アプリの`public`配信やViteの`import.meta.env.BASE_URL`には依存しません。IIFEで使えない`import.meta`が残った場合は、成果物を保存する前にビルドを失敗させます。

組み込みWGSLのバッファ配置は[共通ローダー](../../shared/build/README.md)でアプリのビルド時に解析し、WGSL文字列と配置情報をカタログへ含めます。書き出し時や埋め込み先ではWGSLの構文解析を行わず、`webgpu-utils`・`wgsl_reflect`も同梱しません。GPU上のシェーダーコンパイルや動的な入力bindingの生成は描画先で行います。

`glitch-studio/ui`は書き出しダイアログ・手入力した公開値の検証・スナップショット・素材読み出しを担当し、`glitch-studio/desktop`が別プロセスでのビルドと一時ファイル経由の保存を担当します。手入力の検証コードは配布物に含めません。描画の表示境界は`glitch-studio/renderer/portable-canvas-renderer.ts`です。

## 成果物

生成した成果物の実行にはElectron・Node.js・npmは不要です。

- HTML + JavaScript: `index.html`、`artwork.js`、`README.md`、参照Asset原本をまとめたZIPです。原本は`assets/1.PNG`や`assets/2.mp4`のように、連番と元の拡張子を使って格納します。元のパスがなければAsset名から拡張子を取得します。拡張子がない場合や静的配信用の対象外の場合は`.bin`を使い、MIME型はどの場合も作品データに保持します。`artwork.js`と`assets/`を同じ場所に配信してください。埋め込み先のページから`artwork.js`とCustom Elementを使用すると、`artwork.js`のURLを基準に素材を読み込みます。
- 単一HTML: JavaScriptと参照Asset原本を含むHTMLです。原本はBase64で同梱します。同じページにスクリプトと要素を移して利用するか、HTTPSで配信してiframeでも表示できます。

どちらも画像・動画・フォント・LUTなどの参照Asset原本を含みます。CDNやエディタへの接続は不要です。元ファイルのパスとデバイス識別子は含めません。Native Effectは配置されている種類だけを同梱します。登録型・インライン型のCustom Effectを再帰的にたどり、参照された登録定義を種類・IDごとに一度ずつ同梱します。出力からの到達性やバイパスによるノード削除は行いません。タグ名は書き出しごとのUUIDを持ち、別作品との登録衝突を避けます。

HTTPSまたはlocalhost上のWebGPU対応Chromeを対象にします。COOP/COEPによるcross-origin isolationは必要ありません。配信先のCSPは成果物のscript、`worker-src blob:`、コンポーネントのインラインstyleを許可する必要があります。ZIPに素材がある場合は`connect-src`でも素材の配信元を許可してください。別オリジンへ埋め込む場合、JavaScriptと素材の配信サーバーは埋め込み先からのCORSリクエストを許可する必要があります。単一HTMLはインラインscriptの許可も必要です。式の評価に`unsafe-eval`は使いません。HTML + JavaScriptを`file://`で直接開く使い方は対象外です。

## ランタイムの最適化

Workerにはノードまたはカスタムパラメータが式や有効な式Modifierを使う場合だけAiScriptを同梱します。配列・構造体の子Bindingも調べます。Elementは公開パラメータの既定値を末端までリテラルとして読み取ります。

カスタムパラメータは動的な名前による参照があるため、現在参照されていない式も保守的に含めます。公開APIが受け取るのは値だけなので、外部からの更新でエフェクトや式エンジンの追加が必要になることはありません。

エクスポートは、保存先選択、素材の読み出し、ランタイム生成、保存の順に進みます。ビルド・保存途中はキャンセルでき、確定前の一時ファイルを破棄します。完成ファイルを置き換える区間だけキャンセルを無効にします。

## 公開API

実際のタグ名は生成されたHTML・READMEを参照してください。

```html
<script type="module" src="./artwork.js"></script>
<gs-nodes-effect-example
  id="artwork"
  style="width: 100%; height: 60vh"
  parameters='{"speed": 0.8}'
></gs-nodes-effect-example>
```

```js
await customElements.whenDefined('gs-nodes-effect-example');
const nodesEffectElement = document.querySelector('#artwork');
await nodesEffectElement.ready;
nodesEffectElement.setParameter('speed', 1.2);
nodesEffectElement.setParameters({ speed: 0.5, color: [1, 0.2, 0, 1] });
const speed = nodesEffectElement.getParameter('speed');
nodesEffectElement.resetParameter('speed');
nodesEffectElement.pause();
nodesEffectElement.play();
nodesEffectElement.restart();
```

公開パラメータは `nameForReference`（省略時はパラメータID）で指定し、大小文字を区別します。APIで設定した値、`parameters`属性、書き出し時の初期値、公開定義の既定値の順に優先します。`resetParameter`はAPIの上書きだけを取り消します。属性の削除は属性の上書きをすべて取り消します。

スカラーは有限の数値、真理値・文字列・enumはそれぞれの値、ベクトルは`[x, y]`、色はstraight linear sRGBの`[r, g, b, a]`です。RGBはHDR値を許し、alphaは0〜1です。配列・構造体は通常のJSON配列・オブジェクトで、編集用IDやBindingを含めません。Color Rampは既存の値形式、`any`はRGBAまたは`null`、音声入力は`null`だけを扱います。外部画像・音声を注入するAPIはありません。

公開パラメータの名前・型・値と設定値の有効範囲は呼び出し側で保証します。embedのAPI境界ではこれらを検証しません。`parameters`属性のJSON構文エラーは`error`イベントとなり、属性から取得済みの公開値を維持します。取得した値や呼び出し元のオブジェクトの変更は内部状態に影響しません。

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
- 公開値の更新は変更時のフレームでWorkerへ送ります。フィールド値や配列要素の値を変更しても同じ配置を使います。描画解像度または束縛済みの配列長が変わると配置を再生成し、現在時刻を保持して履歴をリセットします。`restart()`は時間と履歴をリセットし、致命的エラー後の再初期化も行えます。
- DOMからの削除でObserver・イベント・Worker・GPUリソースを解放します。再接続時はcanvasを作り直し、時刻と公開値を保持して履歴をリセットします。同一Document内の同期的なDOM移動では維持します。
- 一要素につき一Worker・一GPUDeviceです。GPU完了まで次のフレームを送らず、描画が遅い場合のキュー蓄積を防ぎます。
- primary pointerの移動・押下を受け取り、`POINTER_POSITION`へ既存の等方座標規約で渡します。余白の位置も出力座標へ換算し、最後の位置を保持します。タッチのスクロールを妨げず、複数ポインター・筆圧・押下状態の新しい環境変数は追加しません。
- 主ボタンや最初の指の`pointerdown`を直近16件保持し、押下位置と内容時刻をEffect共通の描画コンテキストの`pointerClicks`に新しい順で渡します。押下履歴は`restart()`または接続の解除で消去します。
- primary pointerの連続した移動を、両端の位置と内容時刻を持つ線分の列として、Effect共通の描画コンテキストの`pointerStrokeSegments`に渡します。ポインターの退出・キャンセルや指を離した位置で軌跡を区切り、一時停止中の移動は再開後に持ち越しません。
- 音声入力は未接続です。Video Frameは同梱した動画Assetを読み出せます。Timeline・音声出力・タイルレンダリング・パフォーマンス統計は含めません。
- Nodes Effect内の環境変数は`IS_EXPORT=false`、`END_TIME=Infinity`、`PROGRESS=0`です。

## 検証

`pnpm --filter @gs/glitch-studio_embed test`で素材収集・公開値・解像度・HTML/ZIP生成・依存判定・カタログからの最適化ビルドを検証します。ブラウザ統合テストは`CHROME_PATH`にChromeの実行ファイルを設定して同じコマンドで実行します。実際に生成したファイルをローカルHTTPで配信し、WebGPUの画素・透過・ポインター・再接続・複数要素・単一HTMLを検証します。設定がない場合はブラウザテストだけをskipします。
