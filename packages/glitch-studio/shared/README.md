Glitch Studioドメイン内で共通の型や処理などを置く

`src/preview-gamut-compression.ts`は、UIとレンダラーで共有するプレビュー専用の色域圧縮モード・カスタム量を定義する。プロジェクトの保存色や作業色空間とは独立した表示設定で、変換処理と境界LUTはGlitch Studio rendererが所有する。

`src/desktop-update.ts`はElectronのmainとUIが共有する更新状態を定義します。electron-updaterの型や配布URL・インストーラーのパスをUIへ公開しません。

`src/desktop-asset-file.ts`はネイティブ素材選択の要求と結果を定義します。選択結果は原本のパス・名前・MIMEだけを含み、内容の取得や外部参照の選択はUIの取り込み処理が担当します。

`src/effect-live-preview-expression.ts`はEffect Live Previewの公開パラメータで使える式変数を定義する。Effect Live PreviewはGlitch Studio側の利用スコープであり、Nodes Effect自身の評価スコープとは分ける。

`src/effect-live-preview-input.ts`はEffect Live Previewの配置で使う映像・音声入力Bindingと、対応する公開パラメータの判定を定義する。

`src/project/curve-animations.ts`は、プロジェクト共通のCurve Animationとレイヤーのローカル定義を評価用に組み合わせる。保存状態・Nodes Effect内部の定義は変更しない。名前参照はローカルを優先し、ID参照には両方の候補を残す。Timeline subsystemへは組み合わせた定義だけを渡し、プロジェクトへの依存を持ち込まない。

## Effectの登録と受け渡し

プロジェクトはCustom Shader EffectとNodes Effectをそれぞれ登録し、名前やノードの編集情報と、`effect` に渡す `definition` を分けて保存する。`createProjectEffectDefinitions` はそのスナップショットと呼び出し元のNative Effect定義から、種類ごとのIDを解決する。インライン定義は配置の `effectSource` に含まれる。登録IDの一意性は `validateProjectEffectRegistrations`、参照先の存在は `validateEffectSource` などの編集・読み込み・書き出し時の検証で保証し、実行時の索引では再検証しない。

Workerに送る `RendererProjectState` は両方の登録一覧を持つ。定義を編集して利用側の配線も変わる場合は、登録と利用側の変更を同じ `applyRendererProjectChanges` の差分列に含める。インライン定義の編集は、所有するノード・登録定義・Timelineレイヤーの置換で伝える。

`collectNodesEffectResources` は、ルートから未接続ノードも含めてインライン定義・登録参照をたどり、参照先の登録とAssetを含む独立したスナップショットを返す。取り込み時は第3引数で種類と旧IDから新IDを返す関数を渡す。ノードIDと出力ポートIDは保持される。Web書き出しの `PortableNodesEffect` も参照先のCustom Shader Effect・Nodes Effectを同梱する。
