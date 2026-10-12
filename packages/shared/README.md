リポジトリ全体で共通の型や処理などを置く

横着してなんでもかんでもこの層に置くのではなく、本当にどのドメインにも属さず共有する必要があるものだけ置くこと。

あまり肥大化させないのが望ましい

他パッケージを参照することはない。

Glitch Studioドメイン内だけで共有する必要のあるものは、ここではなく`glitch-studio_shared`に置くべし。

## データ型・パラメータ・式の共通基盤

- `src/data-type`: 値の型と、その型に対応する編集UIのメタデータ。UIメタデータは`data-type-ui.ts`に分け、Vueコンポーネントやパラメータの初期値を含めない。
- `src/parameter`: パラメータ定義・Binding・初期値・ツリー操作・CPU値の評価。`parameter-path.ts`は編集対象を識別するIDパス、`parameter-tree.ts`は評価後の配列をたどるindexのパスを扱う。
- `src/expression`: AiScriptの構文・ASTキャッシュ・式の実行。変数と関数は呼び出し側から明示し、Visual ModuleやTimelineを参照しない。
- `src/automation-graph`: グラフの定義・再生設定・補間。`GRAPH`への公開はパラメータ評価器が担当する。
- `src/keyframes`: キーフレームの定義・再生設定・補間。TimelineのScene・レイヤー・クリップから独立し、再生設定はBindingから逆算しない。

`ParameterBindingEvaluator`が受け取る`ValueParameterBinding`は、literal・環境変数・式・グラフ参照・インライングラフ・キーフレームに限定する。時刻、終了時刻、グラフ一覧と式の環境は`ParameterEvaluationScope`で渡す。評価結果やスコープは保持しない。

評価後、受け取り側のパラメータ定義が判明する境界で`coerceParameterValue()`を使う。scalarへ渡された文字列は`Number()`で有限な数値に変換し、空文字列・空白のみ・変換不能・非有限となる文字列はパラメータ名を含むエラーにする。enumの値やstring、保存済みのBindingは文字列のまま保持する。配列・構造体は既存のツリー走査で各scalar末端に適用する。数値以外の型やvector/colorの成分を暗黙変換する処理ではない。

共通の`ParameterBindingBase`はツリー操作に必要な`inputSource`だけを定義する。`resolveParameter`・`walkParameters`・`mapParameterTree`・`walkParameterLeaves`の型引数には、ツリー全体で許可するBinding型を明示する。親がliteralでも子は式やドメイン固有方式になり得るため、親の具体型からは推論しない。走査結果・編集先と`ParameterArrayElement`は指定したBinding型を保持する。既定値にもフォールバックする`walkParameters`の結果には`ValueParameterBinding`を含める。パラメータ定義の初期値は、配列・構造体内部も共通方式に限定する。

`node`・`externalCustomParameterInput`はVisual Module、`layerInput`はTimeline側が型を定義し、共通基盤から参照しない。各ドメインは共通方式に固有方式を組み合わせ、利用可否の検証と参照の解決を担当する。literalの内部値は完全には静的型付けしていないため、配列・構造体内のBindingも受け入れ時に検証する。

## GPU共通基盤

`src/gpu`には、Effect・Visual Module・Timelineやプロジェクトを知らずに使えるGPUデータ表現と処理を置く。

- `uniform-or-texture.ts`: 空間的に一定の値、またはテクスチャを表す`UniformOrTexture`。生成元や接続先の情報、サンプリング設定は持たない。
- `shader-input.ts`: `UniformOrTexture`と受け取り側のサンプリング設定から`ShaderInput`を作る`toShaderInput()`、およびWGSLの読み取り関数とbindingの生成。
- `shader-input-pipeline.ts`: シェーダー入力の構成に応じたpipelineとbindingの管理。
- `uniform-or-texture-to-texture-resolver.ts`: `GPUTexture`が必要な境界で定数だけをテクスチャ化する`UniformOrTextureToTextureResolver`。借用テクスチャの所有権は持たず、自身が作った定数テクスチャだけを管理する。

色はpremultiply済みのまま受け渡し、変換時に再乗算しない。定数をいつテクスチャ化するかとresolverの寿命は呼び出し側が決める。ノードの接続解決、Effectの出力管理、Sceneの画面サイズ確定は、それぞれのドメインが担当する。

## 動画の読み出し

`src/media/video-sample-reader.ts`は素材時刻から表示順のフレームを選ぶ。順方向は現在・次のフレームを保持し、逆方向は最大0.5秒の窓を64MiB・90枚まで保持する。コピー後の画素サイズとフレームのdurationから保持できる窓幅を見積もり、初回もコピー前に読み始めを絞る。見積もった幅は次の補充にも引き継ぐ。durationは窓幅だけに使い、フレームの選択とキャッシュの有効範囲は実際のtimestampで決める。可変FPSなどで見積もりを超える場合も容量制限を守り、単独で上限を超えるフレームは1枚だけ許可する。

逆方向のキャッシュには、デコーダーから独立した画素コピーを使う。`VideoFrame`やそのcloneを窓全体にわたって保持すると、ハードウェアの出力面を使い切り、次のデコードを待ち続けることがある。コピー完了後は元フレームを即時closeし、時刻・色空間・回転・表示寸法を保存する。copyToが切り出したvisibleRectは再適用しない。リセット時は読み取りiteratorも停止し、デコード・コピー待機中に破棄された結果は公開しない。
