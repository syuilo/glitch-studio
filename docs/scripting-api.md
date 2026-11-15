# Project Scripting API

Glitch Studio開発者向けの実装仕様。ユーザー向けチュートリアルではない。
対象はAiScript 1.2.1によるプロジェクト内容の編集であり、保存・環境設定・パネル操作・描画結果取得は公開しない。

## 所有と実行

- `ProjectSessionContext.scripting`が本文・出力・実行状態を所有する。パネル再生成・タブ切替で保持し、プロジェクトファイルには保存しない。
- 同一セッションの複数のScriptingパネルは同じ本文と出力を表示する。パネルを閉じても実行は継続する。
- 実行開始時の本文を新しいParser/Interpreterで実行する。前回の変数・関数は引き継がない。
- JavaScript側は`Interpreter.exec()`による非同期実行。AiScript側の通常の関数呼び出しは、ホスト関数のPromiseを待って戻り値を受け取る。
- 初期版は実行中の編集割り込みが存在しない前提。編集・Undo/Redo・保存・タブ切替等のロック、競合調停、遅延編集の排除は実装しない。
- 実行先はコントローラーを所有する編集セッションに固定し、アクティブタブを参照し直さない。
- トップレベルが終了した時点で実行終了とする。`Async:interval`と`Async:timeout`は呼び出し前にエラーにする。別名に代入しても制限は同じ。
- 標準ライブラリの関数は原則利用できる。`readline`は`Dialog:inputText`と同じホスト関数に接続する。標準ライブラリの共有値は書き換えない。
- 最大実行ステップ数は1,000,000。経過時間による制限はなく、ダイアログ待機はタイムアウトしない。手動停止UIは提供しない。
- セッション破棄時はInterpreterを停止し、待機ダイアログを閉じ、成功済みの履歴を確定する。遅れて返るホスト関数の結果では編集を再開しない。

## 編集と履歴

- 各編集APIは検証後に既存のCommandを即時実行する。読み取りAPIの再呼び出しは直前までの編集を反映する。
- 変更通知・レンダラー同期は通常のCommandと同じ経路。APIの完了はプロジェクト状態の更新を意味し、GPUの描画完了を待たない。
- `UndoRedo.beginGroup()`で成功したCommandを順に記録し、終了時に`Run script`という一つの履歴へ確定する。
- 実行時エラー・正常な早期終了でも、それまでの編集を取り消さない。失敗したAPIより後の処理は実行しない。
- Undoは記録したCommandを逆順に取り消し、Redoは順に再実行する。AiScript本体・乱数生成・入力ダイアログは再実行せず、生成済みのIDと値を復元する。
- 編集APIを実行しなかった場合、履歴は増えず、既存Redoも保持する。同じ値の設定などは通常のCommandと同様に編集として記録する。
- 実行前後の通常入力との自動マージは行わない。グループ内も通常入力用の自動マージは行わない。
- 構文エラーは編集開始前に発生する。API引数エラーは該当操作の変更前に発生する。保存したパラメータ式やシェーダーの描画時エラーは、スクリプト実行エラーとは別に既存の描画経路で扱う。

## 名前と値の契約

- 名前空間は概念の所属を表す。ノードAPIは`VisualModule:Node`に置く。
- メソッドはcamelCase。種類が分かれる生成操作には`createEffect`のように対象種類を含める。
- 作成関数は対象参照を返す。取得関数はスナップショットを返す。取得結果の代入・配列操作でプロジェクトの実体は変わらない。
- 名前・表示名は識別子ではない。名前検索や「現在選択中」の暗黙対象は提供しない。
- プロジェクトAPIへ渡せる値はnull・真理値・有限数・文字列・配列・オブジェクト。関数・AiScriptのerror値・循環参照は拒否する。受け渡しデータの過剰な入れ子も拒否する。
- 引数不足・過剰引数・未知の対象ID・未知のパラメータ・不正な型は実行時エラー。更新失敗を黙って無視しない。
- オプション引数では省略とnullを同じ扱いにする。文字列の空文字列とnullは異なる。
- 変更関数の戻り値は、明記がない限りnull。
- 公開位置・移動・距離は[共通空間座標](spatial-coordinate.md)に従う。色はlinear sRGBのRGBAで、有限の負値・1を超える値も保持する。ベクトルは2成分。

### 対象参照

~~~ts
type VisualModuleReference =
  | { visualModuleId: string }
  | { sceneId: string; inlineVisualModuleLayerId: string };

type VisualModuleNodeReference = {
  visualModule: VisualModuleReference;
  nodeId: string;
};

type ParameterPath = [string, ...string[]];
~~~

参照オブジェクトには上記のフィールドだけを指定する。登録済みとインラインの識別フィールドを混ぜない。
参照の実体はAPI呼び出しごとに解決するため、削除済み対象への参照はエラーになる。

パラメータパスはルートのパラメータIDから始める。構造体はフィールド名、配列は要素IDでたどる。
配列の添字による指定は行わない。初期版でも既存の配列・構造体内部の末端は編集できるが、
コンテナ全体の値置換・要素追加・削除は提供しない。既存要素のIDは取得したBindingから調べる。

## Project・Asset・Effect

| 関数 | 戻り値・意味 |
| --- | --- |
| `Project:get()` | `{ name, description, author, resolution: { width, height }, timelineFps, players }` |
| `Asset:list()` | 素材情報の配列 |
| `Asset:get(assetId)` | 指定素材の情報 |
| `Effect:list()` | `{ id, displayName }[]` |
| `Effect:get(effectId)` | エフェクト定義情報 |

素材情報は`{ id, name, width, height, fileDataType }`。ファイル内容・OSパス・FileSource・サムネイルは返さない。
既存素材のIDはノードの静的設定に使用できる。素材の新規取り込み・削除は対象外。

`Project:get().players`は既存Playerの設定スナップショット（`id, name, sourceType, assetId?`）。
Player参照の静的設定・音声入力を指定するための情報であり、Playerの生成・再生・デバイスアクセスは提供しない。

エフェクト定義情報は`{ id, displayName, description, paramDefs, staticSettingDefs, outputDefs, primaryInputParameter, primaryOutput }`。
未設定の静的設定定義は空オブジェクト、未設定の主入出力はnull。
組み込みエフェクトとプロジェクトのカスタムシェーダーエフェクトを含む。実装関数やGPU資源は公開しない。

パラメータ・静的設定・出力の定義は各ドメインのデータ定義を使用する。
`paramDefs`には`dataType, ui, defaultValue, canNode?`等を含み、配列・構造体の子定義も保持する。
出力ポートの識別子は`outputDefs`のキー。表示名でポートを選ばない。

## VisualModule

| 関数 | 戻り値・意味 |
| --- | --- |
| `VisualModule:list()` | `{ reference, name }[]`。登録済みとScene内のインライン定義を列挙 |
| `VisualModule:get(reference)` | Visual Moduleの設定スナップショットに`reference, name`を加えたもの |
| `VisualModule:create(name)` | 新しい登録済みVisual Moduleへの参照 |
| `VisualModule:rename(reference, name)` | 登録済みVisual Moduleの名前変更 |
| `VisualModule:remove(reference)` | 登録済みVisual Moduleの削除 |
| `VisualModule:connectOutput(reference, outputId, sourceNode, sourcePort)` | 指定出力へ同じVisual Module内のノード出力を接続 |
| `VisualModule:disconnectOutput(reference, outputId)` | 指定出力を未接続へ変更 |

- インライン定義の`name`はnull。Scene ID・レイヤーIDは参照から取得する。
- `get`は`nodes, paramDefs, outputDefs, customParameterDefs, customParameterValues, primaryInputId, primaryOutputId, primaryAudioInputId?, automationGraphs`を含む。
- `create`はUIと共通の既定定義を生成する。In/Outノード、色の公開入力一つ、色の出力一つを持つ。全IDはホストが生成する。
- 初期出力IDは`VisualModule:get(reference).primaryOutputId`から取得する。文字列`"output"`は出力名であり、生成された出力IDではない。
- インライン定義の作成・名前変更・削除はTimeline側の操作に属するため、この初期APIでは扱わない。
- `remove`はTimelineレイヤーから参照されている定義を拒否する。参照レイヤーを暗黙に削除しない。
- 出力定義・主出力の編集は対象外。既存の副出力への接続は可能。

## VisualModule:Node

| 関数 | 戻り値・意味 |
| --- | --- |
| `VisualModule:Node:list(visualModule)` | ノードスナップショットの配列 |
| `VisualModule:Node:get(node)` | ノードスナップショット |
| `VisualModule:Node:getOutputs(node)` | `{ [outputPort]: { dataType, label? } }` |
| `VisualModule:Node:createEffect(visualModule, effectId, staticSettings?)` | 追加したエフェクトノードへの参照 |
| `VisualModule:Node:remove(node)` | エフェクトノードの削除 |
| `VisualModule:Node:setDisplayName(node, displayName)` | エフェクトノードの表示名変更 |
| `VisualModule:Node:setBypass(node, enabled)` | エフェクトノードのバイパス設定 |
| `VisualModule:Node:getParameter(node, path)` | `{ definition, binding }` |
| `VisualModule:Node:setLiteral(node, path, value)` | 固定値入力へ切替・値設定 |
| `VisualModule:Node:setExpression(node, path, code)` | 式入力へ切替・コード設定 |
| `VisualModule:Node:setExpressionModifier(node, path, modifier)` | 加工式設定。`modifier`は`{ enabled: boolean, code: string }`またはnull |
| `VisualModule:Node:resetParameter(node, path)` | 既定状態へ戻す |
| `VisualModule:Node:getStaticSetting(node, settingId)` | 静的設定値 |
| `VisualModule:Node:setStaticSetting(node, settingId, value)` | 静的設定値の変更 |
| `VisualModule:Node:connect(sourceNode, sourcePort, destinationNode, destinationPath)` | ノード出力をパラメータへ接続 |
| `VisualModule:Node:disconnect(node, path)` | パラメータを未接続のノード入力へ変更 |

ノードスナップショットは各ノードの保存フィールドに`reference`を加えたもの。
エフェクトノードの場合、`id, type, effectId, displayName, isBypass, resolution, params, staticSettings, pos?`を含む。
In/Out・relayも列挙・取得・出力参照できるが、その作成・削除は提供しない。

### 追加・削除

- `createEffect`はパラメータと静的設定を既定値で初期化し、指定した静的設定だけを上書きする。未知のキー・不正値は追加前に拒否する。
- UIの「ノード追加時に自動接続」設定には依存しない。追加だけで既存の接続を変更しない。
- パラメータは追加後の個別APIで編集する。複製APIは初期範囲外。
- 削除は通常の`removeNode` Commandと同じ。削除対象への接続は、型互換な主入力の接続元があればそこへ繋ぎ直し、それ以外は未接続にする。補正した接続もUndoで復元する。

### パラメータ

- `getParameter`が返すBindingは保存設定であり、現在時刻における式・ノード出力の評価値ではない。
- 固定値は型を検証して設定する。数値文字列を数値へ暗黙変換しない。UIスライダーのmin/maxによるclampは行わない。
- 色は4有限数、ベクトルは2有限数。enumは定義の選択肢、blendMode・fitMode・wrapMode・sizeReferenceはドメインの列挙値を使う。
- colorRampは既存のColorRamp形式で検証する。`any`はnull・有限数・有限数配列を受け付ける。
- 音声の固定入力はnullまたは`{ type: "player", playerId }`。Playerは同じプロジェクトに存在する必要がある。
- 固定値・式への切替では、通常UIの編集と同様に既存の加工式を保持する。リセットでは加工式も含めて既定状態へ戻す。
- 加工式は対応する値入力だけに設定できる。接続入力・コンテナ・音声入力には設定できない。
- 式本文を保存するAPIは、その場で描画時の変数を使って評価しない。構文・評価の問題は既存のレンダラー側で報告される。
- 静的設定の素材参照は存在するIDと素材のMIME種別を検証する。Player参照も存在を検証する。

### 接続

- 接続元・先は同じVisual Moduleに属する必要がある。自身への接続は拒否する。
- 出力ポートの存在、入力のノード接続対応、型の互換性を変更前に検証する。型検証はUIの型安全設定に依存しない。
- `any`は共通の型互換規則に従う。他の異種型の接続は拒否する。
- 新規接続のサンプリングは`fitMode: "cover", wrapMode: "repeatMirrored", filterMode: "linear"`。
- 接続済みの入力へ繋ぎ直す場合、既存のサンプリング設定を保持する。サンプリング設定専用APIは初期範囲外。
- 切断は固定値への切替ではなく、`{ inputSource: "node", nodeId: null, outputPort: null }`へ変更する。
- Inノードの出力ポートIDは公開パラメータID。relayの出力ポートは`"output"`。

## Dialog・Script・出力

| 関数 | 戻り値・意味 |
| --- | --- |
| `Dialog:alert(text)` | 閉じるまで待機し、null |
| `Dialog:confirm(text)` | 承認はtrue、キャンセルはfalse |
| `Dialog:inputText(text, defaultValue?)` | 入力文字列、キャンセルはnull。既定文字列は空文字列 |
| `Dialog:select(text, items, defaultId?)` | 選択したID、キャンセルはnull |
| `readline(text, defaultValue?)` | `Dialog:inputText`と同じ |
| `Script:exit()` | スクリプト全体を正常終了。呼び出し元へ戻らない |

`text`は文字列。`items`は空でない`{ id: string, label: string }[]`で、IDは重複不可。
`defaultId`は既存の項目IDかnull。省略・nullの場合は先頭を初期選択する。
ダイアログは実行元の編集セッションに所属し、Escや閉じる操作もキャンセルとして扱う。
入力の空文字列はキャンセルのnullと区別する。キャンセルだけで実行を自動終了しない。

出力は`<:`または`print`で行う。

- 実行開始時に前回の出力を消し、出力を順に追記する。エラー時もそれまでの出力を保持する。
- 可変オブジェクトは出力時点の文字列として記録し、後から変わらない。循環参照は`<circular>`と表示する。
- 一出力は最大約4,000文字、深さ20まで。通常出力は1,000件・合計100,000文字までとし、超過分を省略した旨を一度表示する。
- 出力上限はスクリプトの実行を中止しない。上限後も実行時エラーは別枠で残す。
- エラーは履歴を確定した後、ダイアログと出力欄へ表示する。APIエラーには関数名を含め、AiScriptが付加する行・列情報を保持する。
- 出力はUndo対象外。Redoでは再出力しない。

## 基準スクリプト

この例は、作成・設定・接続・最終出力までの最小経路を表す。
このコードと同じ操作を実際のAiScript経由の回帰テストで扱う。

~~~aiscript
let visualModule = VisualModule:create("Generated")
let fillNode = VisualModule:Node:createEffect(visualModule, "fill")
let invertNode = VisualModule:Node:createEffect(visualModule, "invert")

VisualModule:Node:setLiteral(fillNode, ["color"], [1, 0.2, 0.1, 1])
VisualModule:Node:connect(fillNode, "output", invertNode, ["input"])

let definition = VisualModule:get(visualModule)
VisualModule:connectOutput(visualModule, definition.primaryOutputId, invertNode, "output")

<: VisualModule:get(visualModule)
~~~

## 実装境界と拡張

- `ui/src/scripting/project-script-api.ts`: APIの意味・対象解決・引数検証・Commandへの変換。
- `ui/src/scripting/ProjectScriptingController.ts`: 実行寿命・AiScriptとの接続・出力・履歴確定。
- `ui/src/scripting/script-dialog.ts`: セッション所属のダイアログと待機解除。
- `ui/src/utility/undo-redo.ts`: ドメイン非依存のCommandグループ。
- `GsWorkspacePanel.Scripting.vue`: 本文編集・実行操作・出力表示。Ctrl/Cmd+Enterで実行、Tabでタブ文字を挿入。

API追加時は、対象の所属に合う名前空間を選び、型・参照検証を終えてからCommandを実行する。
生成したID・値はCommandへ渡し、Undo/Redo時にスクリプト側の関数を呼び戻さない。
AiScriptの値やVueのRefをsubsystemの型へ持ち込まない。

Timeline編集、公開・カスタムパラメータと出力定義の編集、キーフレーム、Automation Graph、
配列要素の追加削除、ノード複製、素材取り込み、カスタムシェーダー編集は今後の追加範囲。
