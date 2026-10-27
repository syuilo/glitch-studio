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
- `GsLiteralLeafValueControl.vue` は `LeafDataType` と対応する `control`、リテラル値を受け取ります。パラメータ定義やBinding全体は渡しません。array・structの展開とフィールドラベルの表示は上位コンポーネントの責務です。enumの選択肢ラベルは末端コントロールでも使用します。

## Color Ramp

`{ kind: 'colorRamp' }`は、scalarからcolorへの対応表を一つの末端値として扱います。
`packages/shared/src/color-ramp.ts`の`ColorRamp`は`stops`・`interpolation`・`colorSpace`を持ち、
各stopは`{ id, position, color }`です。stop内部にはBindingを持たせません。

- stopは1個以上。IDはランプ内で一意な空でない文字列、位置は0〜1の有限値とします。RGBAは未乗算sRGBの有限値で、alphaは0〜1です。
- 初期値は位置0の黒と位置1の白（不透明）、Linear・sRGBです。RGBの有限な範囲外値は保存できますが、描画結果はsRGBへ戻した後に0〜1へclampします。
- 評価では位置をGPUと同じf32へ丸め、保存順を保って位置順に並べます。同位置では保存順で最後のstopを採用し、左から近づく区間には最初のstopを使います。範囲外は端の色、単一stopは全域でその色です。保存値の順序・位置は変更しません。
- 補間は`constant`・`linear`・`smoothstep`、補間色空間は`srgb`・`linearSrgb`・`oklab`です。色空間の設定変更で保存済みのRGBAを書き換えません。
- 選択した色空間へ変換してからalphaを乗算して補間します。補間後は未乗算へ戻し、sRGBへ変換・clampして再びalphaを乗算します。alphaが0の場合は透明色を返します。端点とConstantでは色空間変換の往復を省略します。
- 固定値・環境変数・ランプ全体を返す基準式と加工式・Visual Moduleの公開入力で利用できます。キーフレーム・Automation Graph・テクスチャとしてのノード接続は扱いません。
- 式は各stopのIDを安定した文字列で返してください。加工式の`VALUE`もランプ全体で、式の内部変更は保存値へ書き戻されません。不正な構造や非有限値はエラーとして報告します。

専用UIはプレビューをクリックすると編集用ポップアップを開き、stopの追加・削除・選択・色・位置を編集します。バーのダブルクリックでその位置へ追加し、追加色は現在の補間色から取得します。重複stopは選択欄から個別に選べます。左右キーで0.01、Shift併用で0.1移動し、Delete/Backspaceで削除します。最後のstopは削除できません。外側のクリック・Escape・閉じるボタンでポップアップを閉じ、開いている間の変更を一つのUndoにまとめます。

```aiscript
// ランプ全体を返す式
{
  interpolation: "linear"
  colorSpace: "oklab"
  stops: [
    { id: "start", position: 0, color: [1, 0, 0, 1] }
    { id: "end", position: 1, color: [0, 0, 1, 1] }
  ]
}
```

```aiscript
// 固定値で編集したランプを加工する式
VALUE.stops[0].color = [1, 0, 0, 0.5]
VALUE.colorSpace = "linearSrgb"
VALUE
```

## パラメータの参照スコープ

- カスタムパラメータの `id` は接続・引数・直接参照の識別子、`nameForReference` は `PARAM` 式から参照する名前、`ui.label` は表示名です。IDと参照名のブランド型を相互に代用せず、表示名を接続のキーにしないでください。
- コードで用意する `nameForReference` の初期値・自動生成名・テストデータは、`my_input`・`my_param_2`・`scene_time` のようなsnake caseに統一します。
- `AutomationGraph` の `nameForReference` は `GRAPH("graph_name", 座標, "clamp")` で照合する参照名で、UIのグラフ選択にも表示します。`automationGraphReference` は `automationGraphId` とグラフの `id` で参照するため、参照名を変更してもその接続は維持されます。インラインの `AutomationGraphData` は参照名・IDを持ちません。
- カスタムパラメータの `canNode: true` はInノードの出力として公開することを表します。内部からはInノードへの配線で参照し、`visualModuleCustomParameterReference` や `PARAM` による直接参照は `canNode: false` のカスタムパラメータに限定する仕様です。ただし音声は`visualModuleCustomParameterReference`だけで参照し、`PARAM`には公開しません。入力が定数かテクスチャかによって参照方法を変えません。
- レイヤーの引数・合成設定と、モジュール内部の式は別の評価スコープです。変数・automation graph・参照可能なパラメータを呼び出し側から明示し、親スコープを暗黙に継承しません。グラフの再生時刻を渡すことと、同名の変数を式に公開することも別です。

## 乱数とノイズの式関数

パラメータの式では、TimelineとVisual Moduleに共通の数値関数を利用できます。

| 関数 | 引数 | 戻り値 |
| --- | --- | --- |
| `RANDOM(index, seed = 0)` | `index`と`seed`は安全な整数（`−(2^53 − 1)`〜`2^53 − 1`） | 0以上1未満の疑似乱数 |
| `NOISE(x, seed = 0)` | `x`は有限の数値、`seed`は安全な整数 | −1〜1の滑らかな1次元Perlin Noise |

負の座標・seedにも対応します。seedだけ省略でき、引数の暗黙変換や丸めは行いません。null・文字列・非有限値や余分な引数は式エラーになり、レンダリングを失敗させます。

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

## 基準値を加工する式

固定値・環境変数・基準式・キーフレーム・Automation Graphによる基準値の取得に、加工式を独立して重ねられます。加工式はInspectorのパラメータメニューから追加します。式の初期値は、基準式では現在の固定値または定義の既定値、加工式では`VALUE`です。

基準式・加工式の本文は入力中のドラフトとして保持し、入力欄の保存ボタン・Ctrl+Enter・Ctrl+Sで適用します。MacではCtrlの代わりにCommandも使用できます。通常のEnterやフォーカス移動では適用しません。キャンセルボタン・Escで未保存の入力を破棄し、現在の適用済みの値へ戻せます。この操作でプロジェクトやUndo履歴は変更しません。構文エラーの表示は保存前の入力内容を対象に更新します。未保存の本文はプロジェクトやレンダラーへ送らず、明示的に適用した式のエラーは従来どおりレンダリング失敗として扱います。

```ts
{
  inputSource: 'expression',
  expression: 'Math:sin(TIME)',
  expressionModifier: {
    enabled: true,
    code: 'VALUE + NOISE(TIME * 3, 1) * 0.03',
  },
}
```

評価は「基準値 → 加工式 → 最終的な範囲の補正」の順です。`VALUE`はその時刻の加工前の基準値で、加工式だけに公開します。パラメータの型に従って数値文字列を数値へ変換してから加工し、式の結果も型・数値の有限性を検証します。stringに数値を表示する式は`Core:to_str(TIME_MS)`のように明示的に文字列化します。式へ渡す値はコピーするため、配列成分の変更が保存値やキーフレームへ漏れることはありません。

`expressionModifier`の未指定・nullは加工なし、`enabled: false`は本文を保持したまま無効化します。有効な基準式・加工式が空文字列または空白だけの場合はエラーです。構文・実行・戻り値の型のエラーもフォールバックせず、そのフレームのレンダリングや書き出しを失敗させます。エラーには基準式／加工式と対象パラメータを含めます。キーが空などの正常な未設定状態に対する既定値の使用とは区別します。

加工式は各利用箇所のBindingに保持します。パラメータ定義の既定Bindingでは、配列・構造体の内部や要素追加用の既定値を含めて加工式を禁止します。既定値は加工前の初期状態を表し、Live Previewで引数を省略した場合も同じ値になります。

基準入力の値や方式を変更しても加工式は保持します。加工式の無効化・削除は基準値に影響せず、パラメータ全体のリセットでは両方を定義の既定値へ戻します。Commandを通した編集・Undo/Redo・保存・複製でも加工式を保持します。

キー追加時に保存する値は加工前の補間値です。プレビュー上のドラッグでは、位置・回転の操作量や拡縮率を基準値へ反映し、加工式を保持します。任意の式を逆算しないため、加工後の最終値がポインターの指定値になるとは限りません。操作終了後の枠は、最終編集が反映されたプレビュー応答で加工後の実際の位置・倍率・回転へ確定します。

加工対象は共通のCPU値の末端Bindingです。配列・構造体のコンテナ、音声、ノード接続・レイヤー画像参照・外部カスタムパラメータ直接参照などのドメイン固有入力は対象外です。対応する入力方式から対象外の方式へ切り替えた場合、加工式は引き継ぎません。`VALUE_AT`・`WIGGLE`や式の多段適用は提供しません。

## プロジェクト共通のAutomation Graph

プロジェクトの`automationGraphs`は曲線の定義（ID・`nameForReference`・点・時間軸の種類）だけを共有する。再生設定は各Binding、評価時刻・終了時刻は参照元の評価スコープが所有する。Timelineでは所属Sceneの時刻を使い、Visual Module Live Previewの公開パラメータへの入力ではLive Previewの時刻を使う。

`automationGraphReference`はIDで解決する。レイヤー内とプロジェクト共通の両方を候補に残すので、同じ参照名でも共通定義をIDで選べる。式の`GRAPH(nameForReference, coordinate, wrapMode)`はローカル定義を優先し、見つからない場合にプロジェクト共通の定義を使う。GroupやTransformのローカル定義を子レイヤーへ継承しない。

共通定義の`nameForReference`はプロジェクト内で一意とし、名前変更でID参照は変わらない。`GRAPH()`内の文字列は自動変更しない。削除後もBindingの参照IDを保持し、未解決のID参照には既定値を使う。一方、式の`GRAPH()`で参照名が見つからない場合は式エラーにする。Undoで同じID・参照名を復元すれば再び解決される。

プロジェクト共通の定義はVisual Module内部のノード・式へ直接公開しない。Visual Module自身のローカル定義は維持し、プロジェクト共通の曲線を使う値は公開パラメータへの引数として渡す。

## Other

Bindingは利用可能な入力方式を所有するドメインで定義します。共通の `ValueParameterBinding` はliteral・環境変数・式・automation・キーフレームだけを扱います。Visual Module内部の `VisualModuleParameterBinding` は共通方式に `node` / `visualModuleCustomParameterReference` を加えます。Timelineの `TimelineVisualModuleParameterBinding` は共通方式に音声用の `lowerLayerAudio` / `anotherLayerAudio` と画像用の `lowerLayerOutput` / `anotherLayerOutput` を加えます。`TimelineEffectParameterBinding` は同じ取得元を扱い、画像Bindingにfit・wrap・filterを持ちます。Visual Module公開入力のサンプリングは内部接続が所有します。Visual Module Live Previewから渡す `VisualModuleArgumentBindings`、タイムラインの合成設定・音量には共通方式だけを許可します。

共通の `ParameterBindingBase` はツリー操作に必要な `inputSource` だけを持ち、保存用の全方式を集めたunionにはしません。共通の走査・IDパスによる編集処理はジェネリックにし、呼び出し側のBinding型を保持します。パラメータ定義の初期値も子要素を含めて共通方式に限定し、ノード接続やレイヤー入力は利用ドメイン側で設定します。複数ドメインを扱う編集用unionはUI側に置き、各Commandへ渡す境界で対象を絞り込みます。literalの内部値の完全な静的型付けは行っていないため、配列・構造体内部の入力方式の実行時検証も維持します。
