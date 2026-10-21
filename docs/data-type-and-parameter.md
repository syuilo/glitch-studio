# DataTypeとParameterの定義

データの型・編集UI・パラメータとしての設定は、それぞれ独立した責務です。定義は `packages/shared/src/data-type/data-type.ts`・`packages/shared/src/data-type/data-type-ui.ts` と `packages/shared/src/parameter/parameter-definition.ts` にあります。

- **`DataType`** は `{ kind: 'scalar' }` のようなオブジェクトです。arrayは `elementType`、structは `fields`、enumは `options` に型に付随する情報を持ちます。UI・初期値・接続可否は持ちません。
- **`DataTypeUiDefinition<T>`** は型に対応する編集方法です。scalarの `controlType` や操作範囲、enumの選択肢の表示名などを持ち、array・structでは再帰します。パラメータ以外のリテラル値の編集にも使えます。
- **`ParameterSettings<T>`** は `defaultValue`・`canNode` と、子要素のパラメータ設定です。子設定に `dataType` やUIを重複して保存しません。
- **`ParameterDefinition<T>`** は上記を組み合わせ、`dataType`・`ui: { label, control }`・パラメータ設定を持ちます。

## 配列・構造体の再帰構造

| 情報 | array | struct |
| --- | --- | --- |
| 子の型 | `dataType.elementType` | `dataType.fields[key]` |
| 子のUI | `ui.control.element` | `ui.control.fields[key]`（`{ label, control }`） |
| 子のパラメータ設定 | `element` | `fields[key]` |

- 配列全体の `defaultValue` と、新規要素を追加するときの `element.defaultValue` は別です。
- arrayの保存値は `ParameterArrayElement[]`（`{ id, binding }[]`）で、`defaultValue`も同じ形式です。IDは同じ配列内で一意にし、編集対象は親まで含むIDのパスで指定します。追加・要素の複製では新しいIDを発行し、値やBindingの種類の変更・移動・Undo/RedoではIDを維持します。新規ノードは既定値のIDをコピーできます。
- リセットは対象Binding内部の配列要素IDを再帰的に再発行します。対象要素自身のIDは親が所有するため維持し、Undo/Redoでは生成済みのIDを復元します。color/vectorの成分配列やキーフレームのIDはこの処理の対象外です。
- 評価後の配列は従来どおり素の値またはShaderInputの配列で、要素ID・Bindingのラッパーは含めません。式から要素IDを指定する参照は提供しません。
- パラメータのコンテナはliteralのBindingを持ち、その内部にも子ごとのBindingを保存します。例えばstructの初期値は `{ inputSource: 'literal', value: { myColor: { inputSource: 'literal', value: [1, 0, 0, 1] } } }` です。評価済みの素の値や、キーフレームに保存するリテラル値と混同しないでください。
- コンテナ自体への式・ノード接続は扱いません。配列・構造体の内部では、末端の設定に従って式や接続を扱います。

## 型の判定・検証とUIへの受け渡し

- 種類の判定は `dataType.kind`、構造を含む型の等価判定は `areDataTypesEqual()` を使います。オブジェクトの `===` で型を比較しないでください。ノード接続の互換性判定は、anyの規約を含む `areNodeDataTypesCompatible()` を使います。
- パラメータ定義全体を種類で絞り込む場合は `isParameterType(def, 'scalar')` などを使えます。種類名だけ必要な選択UIやDOM属性では `DataType['kind']` / `dataType.kind` を使い、保存する型はオブジェクトのままにします。
- enumの `options` は文字列のみです。表示名は `ui.control.labels` に分離し、初期値も選択肢の文字列にします。数値計算やGPUで番号が必要なら利用側の境界で変換します。
- `GsLiteralParameterValueControl.vue` は `LeafDataType` と対応する `control`、リテラル値を受け取ります。パラメータ定義やBinding全体は渡しません。array・structの展開とフィールドラベルの表示は上位コンポーネントの責務です。enumの選択肢ラベルは末端コントロールでも使用します。

## パラメータの参照スコープ

- カスタムパラメータの `id` は接続・引数・直接参照の識別子、`nameForReference` は `PARAM` 式から参照する名前、`ui.label` は表示名です。IDと参照名のブランド型を相互に代用せず、表示名を接続のキーにしないでください。
- コードで用意する `nameForReference` の初期値・自動生成名・テストデータは、`my_input`・`my_param_2`・`scene_time` のようなsnake caseに統一します。
- `AutomationGraph` の `nameForReference` は `GRAPH("graph_name", 座標, "clamp")` で照合する参照名で、UIのグラフ選択にも表示します。`automationGraphReference` は `automationGraphId` とグラフの `id` で参照するため、参照名を変更してもその接続は維持されます。インラインの `AutomationGraphData` は参照名・IDを持ちません。
- カスタムパラメータの `canNode: true` はInノードの出力として公開することを表します。内部からはInノードへの配線で参照し、`externalCustomParameterInput` や `PARAM` による直接参照は `canNode: false` のカスタムパラメータに限定する仕様です。ただし音声は`externalCustomParameterInput`だけで参照し、`PARAM`には公開しません。入力が定数かテクスチャかによって参照方法を変えません。
- レイヤーの引数・合成設定と、モジュール内部の式は別の評価スコープです。変数・automation graph・参照可能なパラメータを呼び出し側から明示し、親スコープを暗黙に継承しません。グラフの再生時刻を渡すことと、同名の変数を式に公開することも別です。

## 乱数とノイズの式関数

パラメータの式では、TimelineとVisual Moduleに共通の数値関数を利用できます。

| 関数 | 引数 | 戻り値 |
| --- | --- | --- |
| `RANDOM(index, seed = 0)` | `index`と`seed`は安全な整数（`−(2^53 − 1)`〜`2^53 − 1`） | 0以上1未満の疑似乱数 |
| `NOISE(x, seed = 0)` | `x`は有限の数値、`seed`は安全な整数 | −1〜1の滑らかな1次元Perlin Noise |

負の座標・seedにも対応します。seedだけ省略でき、引数の暗黙変換や丸めは行いません。null・文字列・非有限値や余分な引数は式エラーになり、既存の評価フォールバックを使います。

両関数とも同じ引数なら常に同じ数値を返します。レイヤー・パラメータ・現在時刻・評価順・呼び出し回数によって変わらないため、シーク・プレビュー・書き出しで同じ値を再現できます。同じ動きを共有するには同じ座標とseedを使い、別の動きには異なるseedを使います。

時間による変化は`TIME`（秒）を明示的に渡して作ります。Timelineの`TIME`は所属Sceneの時刻です。

```aiscript
// 毎秒12回、−0.03〜0.03の範囲で不連続に切り替える
(RANDOM(Math:floor(TIME * 12), 1) * 2 - 1) * 0.03

// 滑らかな揺れ。3は時間方向の倍率で、一定周期の往復回数ではない
NOISE(TIME * 3, 1) * 0.03

// XとYをそれぞれ異なるseedで揺らす
[
  NOISE(TIME * 3, 1) * 0.03,
  NOISE(TIME * 3, 2) * 0.03
]
```

`RANDOM`の第1引数は最小値ではなくサンプル番号です。範囲`min`〜`max`へ変換するには`min + RANDOM(index, seed) * (max - min)`を使います。`NOISE`は整数座標で0になり、格子点の間を連続した勾配でつなぎます。元のパラメータ値を加算する処理は含みません。

実装は整数ハッシュと勾配の5次補間で構成し、乱数生成器の状態や固定長の置換テーブルを保持しません。式のASTだけをキャッシュする既存の評価方式を維持します。

## プロジェクト共通のAutomation Graph

プロジェクトの`automationGraphs`は曲線の定義（ID・`nameForReference`・点・時間軸の種類）だけを共有する。再生設定は各Binding、評価時刻・終了時刻は参照元の評価スコープが所有する。Timelineでは所属Sceneの時刻を使い、Visual Module Live Previewの公開パラメータへの入力ではLive Previewの時刻を使う。

`automationGraphReference`はIDで解決する。レイヤー内とプロジェクト共通の両方を候補に残すので、同じ参照名でも共通定義をIDで選べる。式の`GRAPH(nameForReference, coordinate, wrapMode)`はローカル定義を優先し、見つからない場合にプロジェクト共通の定義を使う。GroupやTransformのローカル定義を子レイヤーへ継承しない。

共通定義の`nameForReference`はプロジェクト内で一意とし、名前変更でID参照は変わらない。`GRAPH()`内の文字列は自動変更しない。削除後も参照IDを保持し、未解決参照は既存の評価フォールバックを使う。Undoで同じIDを復元すれば再び解決される。

プロジェクト共通の定義はVisual Module内部のノード・式へ直接公開しない。Visual Module自身のローカル定義は維持し、プロジェクト共通の曲線を使う値は公開パラメータへの引数として渡す。

## Other

Bindingは利用可能な入力方式を所有するドメインで定義します。共通の `ValueParameterBinding` はliteral・環境変数・式・automation・キーフレームだけを扱います。Visual Module内部の `VisualModuleParameterBinding` は共通方式に `node` / `externalCustomParameterInput` を加えます。Timelineの `TimelineVisualModuleParameterBinding` は共通方式に音声用の `lowerLayerAudio` / `anotherLayerAudio` と画像用の `lowerLayerOutput` / `anotherLayerOutput` を加えます。`TimelineEffectParameterBinding` は同じ取得元を扱い、画像Bindingにfit・wrap・filterを持ちます。Visual Module公開入力のサンプリングは内部接続が所有します。Visual Module Live Previewから渡す `VisualModuleArgumentBindings`、タイムラインの合成設定・音量には共通方式だけを許可します。

共通の `ParameterBindingBase` はツリー操作に必要な `inputSource` だけを持ち、保存用の全方式を集めたunionにはしません。共通の走査・IDパスによる編集処理はジェネリックにし、呼び出し側のBinding型を保持します。パラメータ定義の初期値も子要素を含めて共通方式に限定し、ノード接続やレイヤー入力は利用ドメイン側で設定します。複数ドメインを扱う編集用unionはUI側に置き、各Commandへ渡す境界で対象を絞り込みます。literalの内部値の完全な静的型付けは行っていないため、配列・構造体内部の入力方式の実行時検証も維持します。
