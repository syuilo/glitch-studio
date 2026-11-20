# Electron内蔵MCPサーバー

Electron版のGlitch Studioを、同じコンピューターで動くMCPクライアントから操作できます。Streamable HTTPを使用し、AiScriptによるプロジェクトの参照・編集と、選択中のプレビュー画像の取得を提供します。プロジェクトの保存・素材の取り込み・動画の書き出しは公開していません。

## 有効化と接続

1. 環境設定の「MCPサーバー」を開き、「MCPサーバーを有効にする」をオンにします。
2. AiScriptを実行する場合は「プロジェクトの編集を許可する」もオンにします。
3. 接続先URLと認証トークン、またはクライアント用の接続設定をコピーします。
4. ローカルのMCPクライアントへ登録し、接続します。Glitch Studioは起動したままにします。

初期状態は無効で、ポート番号は`45721`です。接続先は`http://127.0.0.1:45721/mcp`となります。設定はアプリ全体で共有し、次回起動時にも復元します。指定ポートを使用できない場合は設定画面へエラーを表示し、別のポートへ自動変更しません。

認証は各要求の`Authorization: Bearer <token>`で行います。トークンを再発行した場合は、クライアント側の設定も更新してください。コピーした接続設定にはトークンが含まれるため、共有リポジトリへ含めず、個人用の設定として保存します。

待ち受けは`127.0.0.1`に限定しています。クラウドで実行されるコネクターや別のコンピューターから直接接続することはできません。WSL・コンテナー・SSH先で実行するクライアントも、Glitch Studioと同じループバックへ到達できるか確認が必要です。

### Codex

Codexの個人用`config.toml`へ、次の設定を追加します。既存ファイル全体を置き換えず、サーバーの項目を追加してください。環境設定の「Codex用の設定をコピー」では現在のURLとトークンを含む内容を取得できます。

```toml
[mcp_servers.glitch_studio]
url = "http://127.0.0.1:45721/mcp"
http_headers = { Authorization = "Bearer <設定画面からコピーしたトークン>" }
```

設定形式と環境変数経由の認証については[CodexのMCP資料](https://developers.openai.com/codex/mcp/)を参照してください。

### Claude Code

Claude CodeのMCP設定は、次の形式です。環境設定の「Claude Code用の設定をコピー」で現在の接続情報を取得できます。

```json
{
  "mcpServers": {
    "glitch_studio": {
      "type": "http",
      "url": "http://127.0.0.1:45721/mcp",
      "headers": {
        "Authorization": "Bearer <設定画面からコピーしたトークン>"
      }
    }
  }
}
```

CLIから登録する場合は、次の形式でユーザースコープへ追加できます。

```sh
claude mcp add --scope user --transport http glitch_studio http://127.0.0.1:45721/mcp --header "Authorization: Bearer <トークン>"
```

設定場所や再接続の操作は[Claude CodeのMCP資料](https://code.claude.com/docs/en/mcp)を参照してください。

## 利用できるツール

| ツール | 内容 |
| --- | --- |
| `list_project_sessions` | 開いているプロジェクトの編集セッションID、名前、選択中のScene ID、選択状態、スクリプト実行状態 |
| `get_scripting_guide` | AiScriptとプロジェクト操作の短いガイド |
| `search_scripting_api` | Command・Queryの名前や用途を検索 |
| `get_scripting_api` | 指定したCommand・Queryの説明、入力・戻り値のスキーマ、使用例 |
| `execute_script` | 指定した編集セッションでAiScriptを実行 |
| `capture_preview` | 指定した編集セッションの、現在選択中のプレビューをPNGとして取得 |
| `seek_timeline_and_capture` | 現在選択中のTimeline Sceneを指定時刻へシークし、プレビューをPNGとして取得 |

編集を許可していない場合、`execute_script`は利用できません。API資料の取得、編集セッションの一覧、プレビュー画像の取得は利用できます。プロジェクト内容の詳細をQueryから取得する場合も、`execute_script`を使用するため編集の許可が必要です。

編集セッションIDは、プロジェクトを開いている間だけ有効です。保存前のプロジェクトも一覧へ含まれます。編集対象をフォーカスやタブの選択から推測せず、`list_project_sessions`で取得した`projectSessionId`を各操作へ渡してください。

## AiScriptによる編集

最初に`get_scripting_guide`を読み、`search_scripting_api`と`get_scripting_api`で必要なAPIの契約を取得します。資料は実行中のアプリが持つCommand・Queryの定義から生成するため、公開中のAPIと一致します。`get_scripting_api`の`names`には`Command:createCustomNodeGraphEffect`や`Query:getCustomNodeGraphEffect`のように名前空間付きの名前を指定します。

`execute_script`には`projectSessionId`と`source`を渡します。例えば、次のスクリプトはFillノードを持つCustom Node Graph Effectを作成し、作成結果を出力します。

```aiscript
let customNodeGraphEffect = Command:createCustomNodeGraphEffect({ name: "Generated" })
let fillNode = Command:createCustomNodeGraphEffectEffectNode({
  customNodeGraphEffect: customNodeGraphEffect
  effectSource: { type: "nativeEffect", id: "fill" }
  connectionMode: "appendToPrimaryOutput"
})
Command:setCustomNodeGraphEffectNodeParameterSource({
  target: fillNode
  parameterPath: ["color"]
  source: { inputSource: "literal", value: [1, 0.2, 0.1, 1] }
})
<: Query:getCustomNodeGraphEffect(customNodeGraphEffect)
```

`Query:listEffects()`はNative Effectと登録済みのCustom Shader Effectを返します。各項目の`target`を`Query:getEffect`に渡すとパラメータと出力ポートの定義を取得でき、`effectSource`はノードやタイムラインのEffectレイヤーを作成するときに使えます。
登録済みのCustom Node Graph Effectを配置するときは、`Query:listCustomNodeGraphEffects()`の各項目のうち、`target.customNodeGraphEffectId`を持つものを選び、`{ type: "customNodeGraphEffectReference", id: entry.target.customNodeGraphEffectId }`を`effectSource`として渡します。

MCPで渡したスクリプトはScriptingパネルの本文・出力を書き換えません。出力、正常終了したCommandの件数、エラーの有無をツールの結果へ返します。出力量には上限があり、切り詰めた場合は結果に示します。

一回の実行は一つのUndo履歴になります。途中で失敗・中断した場合も成功済みの変更は残り、自動的には巻き戻しません。必要に応じてアプリのUndoを使用します。手動操作は止めないため、実行中の手動編集も同じUndoグループへ含まれる場合があります。同じプロジェクトでScriptingパネルとMCPのスクリプトを同時には実行できません。

MCPの実行では`Dialog:*`と`readline`を使用できません。待ち時間を作る標準関数など、Scripting共通の制限も適用されます。編集セッションを閉じたりサーバーを停止したりした場合は、未完了の実行を中断します。再接続時に変更を重複させないよう、失敗した編集要求を無条件に再実行しないでください。

数値の単位、パラメータ参照、利用できるAPIの考え方は[スクリプティング](scripting.md)と[空間座標](spatial-coordinate.md)を参照してください。

## プレビューの画像取得

`capture_preview`へ`projectSessionId`を渡すと、その編集ウィンドウで選択中のプロジェクトのプレビューを取得します。非選択タブでは映像Workerを解放しているため、画像を取得したいプロジェクトをアプリで選択してください。ツールがタブを自動的に切り替えることはありません。

返却する画像はPNGです。`maxSize`で長辺の上限を指定でき、既定は1024px、最大は2048pxです。縦横比を維持して縮小し、取得した画像の寸法や対象の情報も返します。任意のScene・Custom Node Graph Effectや時刻を指定して描画する書き出し機能ではありません。

Commandの完了はプロジェクト状態への反映を意味し、描画の成功は別に確認します。描画できない場合や取得中に選択対象が変わった場合は、別の対象の画像を返さず失敗します。

### Timelineの時刻を指定して取得

`seek_timeline_and_capture`には`projectSessionId`、`sceneId`、0以上の有限値の`timeMs`を渡します。`sceneId`には`list_project_sessions`の`activeSceneId`を使用します。対象は選択中のプロジェクトとSceneに限り、タブやSceneを自動で切り替えません。`maxSize`は`capture_preview`と同じです。

再生中であれば停止し、Timelineを表示して通常のフレーム単位のシークを行います。結果には要求時刻`requestedTimeMs`、実際の描画時刻`timeMs`、シーク前に再生していたかを示す`wasPlaying`、PNGと対象情報が含まれます。完了後もシーク位置で停止したままです。プロジェクトの編集やUndo履歴には含まれず、編集許可をオフにしていても利用できます。

取得中に手動で時刻・Scene・プロジェクトなどを切り替えた場合、別のフレームを成功として返さず失敗します。中断や失敗後は時刻を自動で戻しません。描画履歴に依存するエフェクトでは、シーク画像が先頭から再生した結果や動画書き出しの結果と異なる場合があります。

## 接続・実行の確認

設定画面にはサーバーの稼働状態と最近の操作を表示します。ポート競合の場合はポート番号を変更し、クライアントのURLも更新してください。認証に失敗する場合は現在のトークンをコピーし直してください。

サーバーを無効にすると新しい要求を受け付けなくなります。プロジェクトの未保存変更は通常の編集状態として残ります。
