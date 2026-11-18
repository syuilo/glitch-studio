# Effect

Native Effect、Custom Shader Effect、Custom Node Graph Effect を、同じ公開定義と描画入口で使用するための subsystem。

| パッケージ | 責務 |
| --- | --- |
| `shared` | シリアライズ可能な `EffectSource` と公開定義、登録定義の解決、編集・読み込み時の静的検証 |
| `renderer` | 配置ごとの `EffectInstance`、Custom Shader Effect の WGSL コンパイル、Custom Node Graph Effect の出力要求と描画順の計画 |
| `native-effects` | Native Effect のカタログと実装。定義を読む入口と GPU 実装を読む入口を個別に公開する |

## 配置と描画

1. 呼び出し側が `EffectCatalog` に Native Effect の定義、登録済み Custom Shader Effect、登録済み Custom Node Graph Effect を渡す。各登録 ID の名前空間は種類ごとに独立している。インラインの `EffectSource` は定義そのものを所有する。
2. 編集や読み込みを確定するときに `validateEffectSource(source, catalog)` で参照・配線を検証する。UI は `resolveEffectDefinition(source, catalog)` から公開パラメータや出力を取得できる。
3. `createEffectInstance(source, options)` に同じ定義のスナップショット、Native Effect の実装一覧、GPUDevice、基準解像度を渡す。利用中は定義・静的設定・寸法を固定し、変更時は新しいインスタンスを作る。グラフ内部も Node ごとにインスタンスを所有する。
4. 各評価で `render({ time, timeDelta, params, requestedOutputIds, commandEncoder })` に必要なポートをまとめて渡す。結果は出力 ID をキーとする借用値で、未配線の出力は結果から省かれる。呼び出し側がエンコーダーを submit してから次の描画を行い、配置を終了するときに `dispose()` する。

描画途中に実装が失敗すると、その評価で履歴が一部だけ進んでいる可能性があるため、描画を行ったルートのインスタンスを子ごと破棄してエラーを返す。呼び出し側は未送信のエンコーダーを破棄し、新しいインスタンスで再開する。

公開入力にリテラル色を渡す場合は未乗算の linear sRGB を使う。レンダラーが空間入力へ変換するときに一度だけ alpha を乗算する。公開入力から出力への直結は定数またはテクスチャをそのまま返す。Fit／Wrap／Filter は入力をサンプリングする Native Effect・Custom Shader Effect の接続に指定する。公開出力の固有寸法は `getOutputResolution(outputId)` で取得する。入力テクスチャの寸法は呼び出し側が `getInputResolution` で提供し、定数の固有寸法は `null` とする。

## 現在の実装範囲

最初の Native Effect は `decomposeVector`。グラフ内の入力はリテラル、公開パラメータ、別ノードの出力を扱う。パラメータは音声以外の単一値型に対応し、配列・構造体、式・キーの評価、既存 Timeline への接続は後続の移行範囲。配置先から渡す `params` は評価済みの値を受け取る。

3種類を組み合わせ、入れ子の2出力を別々の Custom Shader Effect に接続する実例は [WebGPU 統合テスト](./native-effects/test/nested-effect-gpu.ts) にある。`CHROME_PATH` に Chrome の実行ファイルを設定して `pnpm --filter @gs/subsystems_effect-new_native-effects test` を実行すると、描画結果の画素まで検証できる。
