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
instance.render({ commandEncoder, time, timeDelta });
// colorとmaskから結果を借用し、encoderのsubmitは呼び出し側が行う。
```

- 配線、使用出力、各Bindingの `inputSource`、配列の構造、入力種別・寸法・サンプリング、静的設定は生成時に確定する。これらを編集したら配置を再生成する。値や同じ寸法の借用テクスチャの差し替えには入力のgetterを使える。時間は秒、`timeDelta` はミリ秒で渡す。
- Custom Node Graph Effect は各ノードの `effectSource` と公開出力の `outputSources` を持つ。公開入力からの直結はuniformまたはtextureをそのまま転送し、画像を読む接続がFit／Wrap／Filterを指定する。未接続の公開出力は `outputs` に含まれない。出力の寸法は接続元で決まり、uniformは固有寸法を持たない。
- 既定値と配列要素追加用の値はすべてliteralで、初期化時に展開する。式・キーなどの配置Bindingを使用する場合は `bindParameterValue` に評価器の生成関数を渡す。ノードID列で配置を区別し、戻した評価器が各フレームで値を更新する。
- Native Effect と Custom Shader Effect は使用する出力にのみtextureを確保する。Custom Shader Effect は全入力の種別に合わせて配置ごとに一度だけpipelineを生成する。コンパイルが失敗した場合は `createEffectInstance()` が失敗する。
- 同じ配置の複数ポートは1回の `render()` で更新する。GPUコマンドを送信した後、配置の利用終了時に `instance.dispose()` を呼ぶ。外部入力のテクスチャは呼び出し側が所有する。
