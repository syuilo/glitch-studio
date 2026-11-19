# Effect

Native Effect、Custom Shader Effect、Custom Node Graph Effect を共通の公開パラメータと出力ポートを持つ Effect として扱う。公開ポートの固定IDは、表示名・式の参照名・WGSLの名前から独立している。

- `shared` は保存用の [EffectSource](shared/src/effect-source.ts)、公開定義、編集・読み込み時の [静的検証](shared/src/validate-effect-source.ts) を所有する。Native Effect はID参照、他の2種類はID参照とインライン定義に対応する。登録済み定義の一覧は呼び出し側が渡す。
- `renderer` の [createEffectInstance](renderer/src/create-effect-instance.ts) は、1つの配置について初期化を完了したインスタンスを返す。同じ定義を複数箇所から参照した場合も描画履歴とGPU資源は配置ごとに所有する。
- `native-effects` は個々の Native Effect を所有する。UI向けの [定義一覧](native-effects/src/definitions.ts) と、レンダラー向けの [実装一覧](native-effects/src/implementations.ts) は別々に読み込める。呼び出し側は使用する定義と実装だけを登録できる。

## 配置とフレーム

配置を作成するとき、呼び出し側は `usedOutputPorts`、基準解像度、静的設定、評価済み入力の読み取り口を渡す。各入力の種類、テクスチャ寸法、サンプリング設定、コンテナの構造はこの配置の寿命中固定する。UIやタイムラインの式は配置側で評価し、Custom Node Graph Effect 内部の式はそのグラフのスコープで評価する。入力を省略した場合は定義上の既定値を使う。

Custom Node Graph Effect は要求された出力から配線を逆にたどり、入れ子の公開入力・出力、Relay、バイパスを通して実際の生成元を解決する。同一配置の使用ポートを集約してから、必要なノードを依存順に初期化する。各フレームの `render(frame)` はその描画列を一度実行する。公開入力をそのまま出力する経路では、定数やテクスチャを借用する。出力の種類とテクスチャ寸法はポートごとに取得でき、未接続の公開出力は返却される `outputs` に含まれない。

Custom Shader Effect はすべての入力の `uniform`／`texture` を初期化時に決め、配置ごとにパイプラインをコンパイルする。ユーザーWGSLの `Output` は定義した全ポートを持ち、GPUの描画先には使用ポートだけを割り当てる。同じ種類の入力の値や借用テクスチャはフレームごとに変えられる。配線・入力種別・寸法・使用ポートを変更したら配置を作り直す。

```ts
const instance = await createEffectInstance(source, options, environment);
try {
	for (const time of times) {
		const commandEncoder = device.createCommandEncoder();
		const frame = { commandEncoder, time, endTime, timeDelta, isExport: true };
		instance.render(frame);
		const output = instance.outputs[outputId]?.read(frame);
		// 同じencoderに、このフレームの出力を読み取る処理も記録する。
		if (output != null) recordOutput(commandEncoder, output);
		device.queue.submit([commandEncoder.finish()]);
	}
} finally {
	instance.dispose();
}
```

1回の評価につき新しい frame を作る。`time` と `endTime` は秒、`timeDelta` はミリ秒。借用した出力の読み取りとGPUへの送信を済ませてから、同じ配置で次のフレームを描画する。出力を利用する側は借用テクスチャを破棄しない。
