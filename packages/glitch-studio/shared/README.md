Glitch Studioドメイン内で共通の型や処理などを置く

`src/preview-gamut-compression.ts`は、UIとレンダラーで共有するプレビュー専用の色域圧縮モード・カスタム量を定義する。プロジェクトの保存色や作業色空間とは独立した表示設定で、変換処理と境界LUTはGlitch Studio rendererが所有する。

`src/desktop-update.ts`はElectronのmainとUIが共有する更新状態を定義します。electron-updaterの型や配布URL・インストーラーのパスをUIへ公開しません。

`src/desktop-asset-file.ts`はネイティブ素材選択の要求と結果を定義します。選択結果は原本のパス・名前・MIMEだけを含み、内容の取得や外部参照の選択はUIの取り込み処理が担当します。

`src/custom-node-graph-effect-live-preview-expression.ts`はCustom Node Graph Effect Live Previewの公開パラメータプレビューに公開する変数名を定義する。Custom Node Graph Effect Live PreviewはGlitch Studio側の利用スコープであり、Custom Node Graph Effect自身の評価スコープとは分ける。

`src/player-audio-source.ts`は音声取得元としてのPlayer指定と、その検証を所有する。共通パラメータ層は静的な指定であることだけを扱い、Playerの選択形式やTimelineのレイヤー参照を共通の取得元一覧へ集めない。

`src/project/automation-graphs.ts`は、プロジェクト共通のAutomation Graphとレイヤーのローカル定義を評価用に組み合わせる。保存状態・Custom Node Graph Effect内部の定義は変更しない。名前参照はローカルを優先し、ID参照には両方の候補を残す。Timeline subsystemへは組み合わせた定義だけを渡し、プロジェクトへの依存を持ち込まない。
