Glitch Studioドメイン内で共通の型や処理などを置く

`src/desktop-update.ts`はElectronのmainとUIが共有する更新状態を定義します。electron-updaterの型や配布URL・インストーラーのパスをUIへ公開しません。

`src/live-expression.ts`はVisual Module Live Previewのカスタムパラメータプレビューに公開する変数名を定義する。Visual Module Live PreviewはGlitch Studio側の利用スコープであり、Visual Module自身の評価スコープとは分ける。

`src/player-audio-source.ts`は音声取得元としてのPlayer指定と、その検証を所有する。共通パラメータ層は静的な指定であることだけを扱い、Playerの選択形式やTimelineのレイヤー参照を共通の取得元一覧へ集めない。
