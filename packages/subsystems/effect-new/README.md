# Effect

`shared` は Native Effect、Custom Shader Effect、Custom Node Graph Effect の公開定義と保存形式を所有する。登録IDの解決は呼び出し側から渡す。編集・読み込み時には `validateEffectSource()` で既定値とグラフの参照・循環を確認する。

`renderer` は配置ごとに実行状態を生成する。`native-effects` は個々の Native Effect を所有し、UI用の定義一覧と実装一覧を別々に公開する。利用する Native Effect だけを渡すこともできる。

## 配置の生成と描画

```ts
const instance = await createEffectInstance({
	effectSource,
	definitions,
	resolution,
	inputs,
	usedOutputPorts: new Set(['color', 'mask']),
}, gpu, getNativeEffectImplementation);

const color = instance.outputs.get('color');
const mask = instance.outputs.get('mask');
// 各フレームで実行。後続の描画も同じencoderに記録できる。
const frame = { time, timeDelta };
await instance.prepare(frame);
instance.render(frame, commandEncoder);
// colorとmaskから結果を借用し、encoderのsubmitは呼び出し側が行う。
```

- 配線、使用出力、各Bindingの `inputSource`、配列の構造、入力種別・寸法・サンプリング、静的設定は生成時に確定する。これらを編集したら配置を再生成する。値や同じ寸法の借用テクスチャの差し替えには入力のgetterを使える。時間は秒、`timeDelta` はミリ秒で渡す。
- Custom Node Graph Effect は各ノードの `effectSource` と公開出力の `outputSources` を持つ。公開入力からの直結はuniformまたはtextureをそのまま転送し、画像を読む接続がFit／Wrap／Filterを指定する。未接続の公開出力は `outputs` に含まれない。出力の寸法は接続元で決まり、uniformは固有寸法を持たない。
- 既定値と配列要素追加用の値はすべてliteralで、初期化時に展開する。`params` は配置側のBinding、`inputs` は解決済みの入力で、同じIDでは `inputs` が優先される。式・環境変数・キー・Automation Graph・加工式は標準評価器が処理する。ホスト固有の処理は `bindParameterValue` で差し替えられる。
- 旧実装の `canLazyAllocation` は廃止した。`createEffectInstance()` は `usedOutputPorts` に指定された公開出力から配線を逆にたどり、描画に必要な Native Effect・Custom Shader Effect の出力ポートだけにテクスチャを確保する。各実装は初期化時に `outputTextures` でそのポートとテクスチャを受け取る。使用する出力が変わったらインスタンスを作り直す。
- Custom Shader Effect は全入力の種別と使用する出力に合わせて、配置ごとに一度だけpipelineを生成する。ユーザーのWGSL関数は定義された全出力を持つ `Output` を返し、生成したfragmentエントリポイントが使用する出力だけを描画先へ書き込む。コンパイルが失敗した場合は `createEffectInstance()` が失敗する。
- Native Effect の出力ごとに `inputParameters` で描画に使う入力を指定できる。省略時は全入力を使う。たとえば Vignette の Mask だけを使う配置では、入力画像の寸法から解像度を決め、マスクを1パスで描く。色とマスクを両方使う配置でも Vignette 自体の描画は1パスで済む。
- Feedback は配置ごとに2枚のtextureを交互に使う。出力ポートは保持できるが、最新のtextureは各フレームの `render()` 後にそのポートの `.texture` から取得する。シークなどで `instance.resetRenderHistory()` を呼ぶと、入れ子を含む各配置は次の描画から新しい履歴を開始する。Feedback は、その最初の描画ではリセット前の経過時間を加算しない。
- 同じ配置の複数ポートは1回の `render()` で更新する。GPUコマンドを送信した後、配置の利用終了時に `instance.dispose()` を呼ぶ。外部入力のテクスチャは呼び出し側が所有する。

## 値・寸法・外部入力

- Custom Node Graph Effect の `PUBLIC(name)` は自身の公開CPUパラメータを、`CUSTOM(name)` は自身の内部パラメータを、`GRAPH(name, x, wrap)` は自身の Automation Graph を参照する。内部値は参照されたフレーム内で一度評価する。入れ子のノードに渡す引数のBindingは親グラフに属する。Relay は初期化時に入力のポートへ解決する。
- `time` と `endTime` は秒、`timeDelta` とキー・Automation Graphの時間軸はミリ秒。`endTime` 省略時は無限の再生区間とする。ポインターの位置・移動量は配置の基準領域の長辺を1とする座標で渡す。各ノードでは描画解像度の縦横比へ換算した値を描画と式評価で共有する。
- 配置には基準寸法 `resolution`、全体倍率 `resolutionScale`、解像度指定 `resolutionSetting` を渡せる。ルートは既定でcontext、内部ノードはauto。autoは素材原寸、指定入力の最大画素数の寸法、親の順で選ぶ。上流の計画寸法には全体倍率が適用済みで、各配置では自身の倍率だけを掛ける。
- `resources` には素材メタデータ、画像テクスチャ、Playerの寸法と現在画像の取得関数を渡す。Native Effect は初期化時に画像、ファイルの読み取り口、またはPlayerの取得関数を借用する。音声のリテラルは `resolveAudioSource(source, frame)` で、そのフレームを基準とする `AudioInput` に解決する。素材の選択や寸法を変えた場合は配置を再生成する。

## フレームの準備と実行

```ts
// 書き出しは準備完了を待ち、同一のframeを描画に渡す。
await instance.prepare(frame, signal);
instance.render(frame, commandEncoder);
device.queue.submit([commandEncoder.finish()]);
```

- プレビューは `tryPrepare(frame)` がtrueのときに描画できる。同じフレームオブジェクトで再確認すると評価値を再利用し、新しいフレーム・リセット・破棄は前の準備を中断する。`preparationStatus` と `onPreparationStatus` で準備状態とエラーを取得できる。準備から描画完了まで、呼び出し側は借用入力を同じフレームに保つ。Native Effect の `prepare(frame, signal)` は必要な読み込みのPromiseを返し、中断後の結果を反映しない。
- `cacheKey` を公開するNative EffectとCustom Shader Effectは、入力とキーが一致すれば前回の描画結果を再利用する。時刻・ポインター・再生中のPlayerなどを直接読むNative Effectは毎回描画するか、それらの変化をキーに含める。外部テクスチャは同じ画像への書き込みでも `version` を更新する。世代を省略したテクスチャと履歴依存の配置は毎回描画する。下流には実際に描画した出力の世代を伝える。
- `tiling` はdisabled（既定）、manual（`tileSize`）、autoに対応する。`await instance.renderTiled(frame, signal, onProgress)` は準備からコマンドの送信までを所有する。manualはRender Passを分割し、autoは `canHaveLongRunningRenderPass` を宣言したNative Effect・Custom Shader Effectを対象に負荷・実測に応じて分割する。通常のノードは同じencoderにまとめる。中断したフレームは履歴とキャッシュを無効化し、次の成功した描画の出力から利用できる。
- `onGpuTime(nodePath, passIndex, milliseconds)` を指定するとRender Pass・Compute Passの時間を通知する。分割したパスでは実行したタイルの時間を集計する。timestamp-queryのないデバイスではnullを通知する。
