# AiScriptによるプロジェクト編集

ワークスペースのパネル種類を「スクリプティング」に切り替えると、AiScriptを編集・実行できます。実行ボタン、またはエディター内のCtrl/Cmd+Enterで実行します。`<:`と`print(...)`の出力はパネル下部に表示されます。

## 本文・実行・履歴の寿命

本文と出力はプロジェクトの編集セッションが保持する一時状態です。タブを切り替えたりパネルを閉じて開き直したりしても残り、同じプロジェクトに複数のスクリプティングパネルがある場合は共有します。プロジェクトファイルには保存せず、プロジェクトを閉じると破棄します。

実行ごとに新しいインタプリタを作成するため、前回の変数・関数は引き継ぎません。実行開始時に前回の出力を消し、実行開始時の本文を最後まで実行します。途中で本文を書き換えても、その実行には影響しません。

AiScript自体は非同期で実行します。Commandの準備やダイアログの応答は、通常の関数呼び出しの中で待機するため、スクリプトに`await`を書く必要はありません。変更は順次プロジェクトへ反映され、同じ実行中のQueryからも読み取れます。Commandの完了は状態への反映を意味し、GPUによる描画完了や描画結果の正常性を保証しません。

一回の実行による変更は一つのUndo履歴になります。実行時エラーはダイアログと出力欄へ表示し、残りの処理を中止します。それまでに成功した変更は残るため、取り消す場合は通常のUndoを使います。Redoは確定した変更・IDを復元し、スクリプトやダイアログを再実行しません。編集のない実行は履歴を増やさず、既存のRedoも保持します。本文・出力・ダイアログの応答はプロジェクトのUndo対象外です。

実行中も手動編集を禁止する専用の排他制御は設けていません。同じ編集セッションで行った手動編集が、スクリプトと同じUndo履歴に含まれることがあります。同じ編集セッションでのスクリプトの二重実行は受け付けません。途中停止のUIはなく、パネルを閉じても実行は続きます。編集セッションを破棄した場合は実行と待機ダイアログを終了し、遅れて完了したCommandの準備結果を適用しません。

## 最初のスクリプト

次の例は、Fillノードと出力接続を持つNodes Effectを作成し、その保存内容を出力します。作成したNodes EffectはNodes Effect Editorから選択できます。

```aiscript
let nodesEffect = Command:createNodesEffect({ name: "Generated" })
let fillNode = Command:createNodesEffectEffectNode({
	nodesEffect: nodesEffect
	effectSource: { type: "nativeEffect", id: "fill" }
	connectionMode: "appendToPrimaryOutput"
})

Command:setNodesEffectNodeParameterSource({
	target: fillNode
	parameterPath: ["color"]
	source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] }
})

<: Query:getNodesEffect(nodesEffect)
```

色は既存のパラメータと同じlinear sRGBです。公開する位置・距離も通常の編集と同じ共通単位を使います。詳細は[空間座標](spatial-coordinate.md)を参照してください。

## Command

共有の固定カーブは、たとえば `Command:createProjectFunctionCurve({ nameForReference: "flash", data: { type: "pulse", dutyCycle: 0.25 } })` で作成できます。

編集は`Command:<Command名>({ ...入力... })`で行います。名前・入力・戻り値はUIが利用するCommandと共通です。例えば`Command:createNodesEffect`は`{ nodesEffectId }`を返し、そのまま次のCommandの`nodesEffect`へ渡せます。戻り値のないCommandは`null`を返します。引数オブジェクトは必須なので、既定値だけで作る場合も`Command:createNodesEffect({})`と書きます。

利用可能な名前と説明は実行中のアプリから取得できます。

```aiscript
<: Script:commands() // [{ name: "setProjectName", label: "Set project name" }, ...]
```

公開対象の正確な一覧は[script-command-names.ts](../packages/glitch-studio/ui/src/scripting/script-command-names.ts)にあります。各入力・戻り値の契約は次のCommand定義を参照してください。公開リストに含まれる名前だけがAiScriptから呼び出せます。

| 対象 | 主な操作例 | 入力・戻り値の定義 |
|---|---|---|
| Project・Function Curve | `setProjectName`、`setProjectResolution`、`createProjectFunctionCurve`、`duplicateProjectFunctionCurve`、`replaceProjectFunctionCurve`、`removeProjectFunctionCurve` | [project.ts](../packages/glitch-studio/ui/src/commands/project.ts) |
| Nodes Effect・Node | `createNodesEffect`、`createNodesEffectEffectNode`、`removeNodesEffectNode` | [nodes-effect.ts](../packages/glitch-studio/ui/src/commands/nodes-effect.ts) |
| Nodes Effectのパラメータ・入出力 | `setNodesEffectNodeParameterSource`、`replaceNodesEffectNodeParameterBinding`、`setNodesEffectOutputConnection` | [nodes-effect-parameters.ts](../packages/glitch-studio/ui/src/commands/nodes-effect-parameters.ts) |
| Scene・Layer・Clipの作成と素材情報を要する操作 | `createTimelineScene`、`createTimelineLayer`、`createTimelineClip`、`trimTimelineClip` | [timeline-api.ts](../packages/glitch-studio/ui/src/commands/timeline-api.ts)、[timeline-creation.ts](../packages/glitch-studio/ui/src/commands/timeline-creation.ts) |
| Timelineの配置・階層・設定・キー | `moveTimelineLayerInTree`、`moveTimelineClips`、`setTimelineLayerName`、`setTimelineLayerMask`、`insertTimelineKeyframes` | [timeline.ts](../packages/glitch-studio/ui/src/commands/timeline.ts) |
| Timelineの公開パラメータ | `createTimelineLayerPublicParameter`、`replaceTimelineLayerPublicParameterDefinition` | [timeline-parameters.ts](../packages/glitch-studio/ui/src/commands/timeline-parameters.ts) |
| Timelineのパラメータ値 | `setTimelineLayerParameterSource`、`replaceTimelineLayerParameterBinding` | [timeline-parameter-api.ts](../packages/glitch-studio/ui/src/commands/timeline-parameter-api.ts) |
| 既存Asset | `setAssetName`、`removeAsset` | [resources.ts](../packages/glitch-studio/ui/src/commands/resources.ts) |
| Custom Shader Effect | `createCustomShaderEffect`、`replaceCustomShaderEffectDefinition` | [custom-shader-effect.ts](../packages/glitch-studio/ui/src/commands/custom-shader-effect.ts) |

固定値・式・接続は、各Commandが受け取る入力方式で明示します。例えば`setNodesEffectNodeParameterSource`は入力元を設定して既存の加工式を保持し、`replaceNodesEffectNodeParameterBinding`は加工式を含めたBinding全体を置き換えます。`parameterPath`は配列で指定し、配列要素のパスにはインデックスではなく要素IDを使います。

公開するCommandはプロジェクト内容の編集に限ります。プロジェクト保存、環境設定変更、パネル操作、書き出し設定の変更、ファイル選択や素材の新規取り込みは提供しません。Blobや取り込み済みの内部配置情報を必要とするCommandも公開しません。

Command・Query・Dialogとの受け渡しには、`null`、真理値、数値、文字列、それらの配列・オブジェクトを使います。関数や循環参照を含む値は渡せません。型・参照先・編集条件の不正はエラーになります。

## APIの契約と説明を調べる

すべての公開Command・Queryは、説明・AiScriptの実行例・入力スキーマ・結果スキーマを持ちます。実行中のアプリと同じ定義から資料を生成するため、次の関数で利用可能なAPIを検索し、正確な引数を確認できます。読み取りだけで、Undo履歴は作りません。

```aiscript
<: Script:search("NodesEffect")
let api = Script:describe("Command:createNodesEffect")
<: api.description
<: api.inputSchema
<: api.resultSchema
<: api.examples

<: Script:describe("Query:getEffect")
```

`Script:search(text)`は名前と説明を大文字・小文字を区別せず検索し、`name`・`kind`・`argumentCount`・`description`の一覧を返します。空文字なら全公開APIを返し、空白で区切った語はすべて含まれるものを探します。説明は英語です。

`Script:describe(name)`には`Command:`または`Query:`を含む正式名を指定します。検索結果の項目に加え、`examples`・`inputSchema`・`resultSchema`を返します。スキーマはJSON Schema形式で、再帰構造は`$ref`で表します。引数を取らないQueryは`argumentCount: 0`・入力スキーマは`null`型ですが、実際には引数なしで呼び出します。結果のないCommandの結果スキーマも`null`型です。実行例の先頭コメントで既存のNodeやLayerを前提とするものは、先にその参照を取得してから実行してください。

入力の構造はCommandの準備やQueryの読み取り前に検証します。Commandの結果も変更の適用前に検証します。参照先の存在、パラメータとの型の対応、接続や編集の可否など、プロジェクトの状態に依存する検証は既存のドメイン処理が担当します。JSON Schemaを満たすだけで、任意の状態で操作が成功するという意味ではありません。検証では値の型を自動変換したり、未記載フィールドを削除したりしません。

## Query

Queryは呼び出した時点の保存内容を取得します。式やキーフレームを現在時刻で評価した値、レンダリング結果、UIの選択状態は扱いません。戻り値はプロジェクトから切り離したデータなので、取得結果を書き換えてもプロジェクトは変わりません。

```aiscript
<: Script:queries() // 利用可能なQueryの名前
<: Query:listNodesEffects()
<: Query:listEffects()
<: Query:getEffect({ effectSource: { type: "nativeEffect", id: "fill" } })
```

一覧の各項目が持つ`target`を、そのまま対応する取得関数へ渡せます。作成Commandはこの参照自体を返します。

| API | 引数 | 内容 |
|---|---|---|
| `Query:getProject()` | なし | 名前・説明・作者・解像度・Timelineの描画設定・書き出し設定 |
| `Query:listNodesEffects()` | なし | 登録済みとScene内のインラインNodes Effectの`target`・名前 |
| `Query:getNodesEffect(target)` | Nodes Effect参照 | ノード・パラメータ・出力定義などの保存内容 |
| `Query:listNodes(target)` | Nodes Effect参照 | ノードの参照・種別・`effectSource`・表示名 |
| `Query:getNode(target)` | Node参照 | ノードの保存内容 |
| `Query:listTimelineScenes()` | なし | Scene参照・名前・解像度 |
| `Query:getTimelineScene(target)` | Scene参照 | Scene全体の保存内容 |
| `Query:listTimelineLayers(target)` | Scene参照 | 子孫を表示順に並べたLayer一覧。`parentLayerId`で親を表す。Effectを配置したLayerはすべて`layerType: "effect"` |
| `Query:getTimelineLayer(target)` | Layer参照 | Layerの保存内容。Effect Layerの`effectSource`からEffectの種類と参照先またはインライン定義を取得できる |
| `Query:getTimelineLayerParameters(target)` | Layer参照 | パラメータグループごとの`definitions`・`values` |
| `Query:listTimelineClips(target)` | Layer参照 | Clip一覧。コンテナLayerの場合は空配列 |
| `Query:getTimelineClip(target)` | Clip参照 | Clipの保存内容 |
| `Query:listAssets()` / `Query:getAsset(target)` | 一覧は引数なし／Asset参照 | 素材の名前・寸法・ファイル種別などのメタデータ。バイナリ・サムネイルは含まない |
| `Query:listEffects()` / `Query:getEffect(target)` | 一覧は引数なし／Effect参照 | Native Effect と登録済みの Custom Shader Effect・Nodes Effect を列挙する。各項目の `target` からパラメータ・静的設定・出力を取得できる |
| `Query:listProjectFunctionCurves()` / `Query:getProjectFunctionCurve(target)` | 一覧は引数なし／Function Curve参照 | ProjectのFunction Curve |
| `Query:listCustomShaderEffects()` / `Query:getCustomShaderEffect(target)` | 一覧は引数なし／Custom Shader Effect参照 | どちらも入力された概要を文字列の `summary` で返す。取得では保存された定義全体を返す |

対象参照の形式は次のとおりです。存在しない対象の取得はエラーになります。

| 対象 | 参照 |
|---|---|
| 登録済みNodes Effect | `{ nodesEffectId: "..." }` |
| Scene内のEffect Layerが所有するインラインNodes Effect | `{ sceneId: "...", layerId: "..." }` |
| Node | `{ nodesEffect: nodesEffectTarget, nodeId: "..." }` |
| Scene | `{ sceneId: "..." }` |
| Layer | `{ sceneId: "...", layerId: "..." }` |
| Clip | `{ sceneId: "...", layerId: "...", clipId: "..." }` |
| Asset / Effect | `{ assetId: "..." }` / `{ effectSource: { type: "nativeEffect", id: "fill" } }` など |
| ProjectのFunction Curve | `{ functionCurveId: "..." }` |
| Custom Shader Effect | `{ customShaderEffectId: "..." }` |

Timelineのパラメータグループは`Query:getTimelineLayerParameters`のキーで確認できます。配置したEffectの引数は3種類とも`effect`、Layer自身に宣言した公開パラメータは`publicParameter`です。Commandの`parameterGroup`にも同じ名前を指定します。

## Dialogと正常終了

Dialog関数は一つのオプションオブジェクトを受け取ります。`title`・`text`は省略可能な文字列です。`default`はテキストの初期値、または選択項目のIDを指定します。

| API | 戻り値 |
|---|---|
| `Dialog:alert({ title, text })` | 閉じると`null` |
| `Dialog:confirm({ title, text })` | 承認なら`true`、キャンセルなら`false` |
| `Dialog:input_text({ title, text, default })` | 確定した文字列、キャンセルなら`null` |
| `Dialog:select({ title, text, items, default })` | 選択した項目ID、キャンセルなら`null` |

`select`の`items`は、`{ id: "red", label: "Red" }`のようなオブジェクトを一つ以上含む配列です。ID・ラベルは文字列で、IDは重複できません。既定値を指定する場合は、items内にあるIDを使います。省略時は先頭項目を選択します。

```aiscript
let name = Dialog:input_text({
	title: "Nodes Effect"
	text: "Enter a name"
	default: "Generated"
})
if name == null {
	Script:exit()
}

if !Dialog:confirm({ text: "Create the Nodes Effect?" }) {
	Script:exit()
}

let nodesEffect = Command:createNodesEffect({ name: name })
<: nodesEffect
Dialog:alert({ text: "Created" })
```

入力を空のまま確定した結果は`""`で、キャンセルの`null`とは区別します。Escや閉じる操作もキャンセルです。キャンセルだけでスクリプト全体は終了せず、戻り値を見て続行・再入力・終了を決めます。標準の`readline("入力内容")`もテキスト入力ダイアログへ対応し、同じく文字列または`null`を返します。

`Script:exit()`はその場で正常終了します。エラーダイアログを出さず、実行済みの変更はUndoできる状態で残します。

## エラーと制限

次の例では、解像度の変更だけが失敗し、名前の変更は残ります。ダイアログを閉じてUndoすると、実行前の名前へ戻ります。

```aiscript
Command:setProjectName({ name: "Changed by script" })
Command:setProjectResolution({ resolution: { width: 0, height: 1080 } })
```

実行ステップ上限は1,000,000です。ダイアログでの入力待ちに経過時間制限はありません。実行終了後へ処理を残す`Async:interval`・`Async:timeout`と、`Core:sleep`は利用できず、呼び出すとエラーになります。

通常出力は一回の実行につき1,000件または100,000文字までです。上限に達したら省略メッセージを追加し、以降の通常出力を省略します。巨大な値は残り文字数で切り詰め、深い入れ子は省略し、循環参照は`[Circular]`と表示します。実行中に出力を消去しても、その実行の出力予算は回復しません。エラーの理由は通常出力が上限に達していても末尾へ記録します。

## 実装の担当

- [ProjectScriptingController](../packages/glitch-studio/ui/src/scripting/ProjectScriptingController.ts): セッション内の本文・出力・実行状態、Undoのグループ、エラー表示。
- [project-script-runtime](../packages/glitch-studio/ui/src/scripting/project-script-runtime.ts): 一回分のAiScript環境、関数登録、ダイアログ待機、ステップ制限、終了処理。
- [project-script-queries](../packages/glitch-studio/ui/src/scripting/project-script-queries.ts): 保存状態と定義の読み取り。
- [project-api/contract](../packages/glitch-studio/ui/src/project-api/contract.ts): Command・Query共通の契約、構造検証、JSON Schemaへの変換。
- [project-script-api-reference](../packages/glitch-studio/ui/src/scripting/project-script-api-reference.ts): 公開APIの検索と説明取得。通信方式から独立しており、将来のMCPでも同じ資料を取得する入口。
- [script-values](../packages/glitch-studio/ui/src/scripting/script-values.ts): AiScriptとホストのデータ変換、出力整形。
- [project-script-dialog](../packages/glitch-studio/ui/src/scripting/project-script-dialog.ts): 編集セッションに所属するダイアログと、その結果・寿命。

編集の意味・ID生成・検証・Undo/Redoは既存Commandが所有します。AiScript専用の別実装へ複製しません。

公開Commandの追加時は`definePublicCommand()`にZodの`inputSchema`・`resultSchema`と説明・例を渡し、入力・結果の型を推論させます。既存のドメイン型を組み合わせたCommandには`withCommandContract()`で契約を付けられます。公開リストにあるCommandの契約漏れは型チェックで検出します。内部用のBlobなどを扱うCommandには契約を要求しません。スキーマは検証と資料生成に使うため、`transform`・`coerce`・`default`などの値を変える定義は使いません。
