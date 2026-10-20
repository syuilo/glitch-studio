# Electron版

Windows x64向けのNSISインストーラーと、macOSのApple Silicon（arm64）・Intel（x64）向けのDMGを配布します。開発起動はルートで`pnpm dev:desktop`を実行します。公開しない配布ビルドは、Windows上では`pnpm dist:desktop:win`、macOS上では`pnpm dist:desktop:mac`を実行します。macOSのコマンドは両アーキテクチャを生成します。出力先はルートの`release/`です。

desktopのパッケージ名は`@gs/glitch-studio_desktop`です。electron-builderがpnpmのworkspace一覧から実行時依存を収集する際にも使われるため、ルートと同名にしたり省略したりしないでください。`afterPack`でASAR内の実行時依存を再帰的に検査します。

## 未保存の変更の終了確認

UIが終了・再読み込み時に未保存の変更を判定し、`project-close-guard.mjs`へ同期IPCで確認を要求します。mainは送信元を検証し、UIの言語でOSの確認ダイアログを表示します。「保存せずに閉じる」を選んだ場合だけ元の要求を続行し、キャンセル・Esc・ダイアログ表示の失敗では取り消します。保存中は既存の終了防止を優先します。確認済みの自動更新による終了では重ねて確認せず、更新準備・ダウンロード中の終了防止も維持します。

`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/project-close-guard-electron.test.mjs`を実行すると、非表示のElectronウィンドウで終了の取消・許可、再読み込み、保存中の保護、更新時の確認省略、アプリ終了を検証します。OSダイアログの返答だけを置き換え、実際のpreloadとUI・main間の同期IPCを使います。

## 外部参照アセット

`external-assets.mjs`は原本の可読性確認、パスの相対化・解決、原本書き出しを担当します。登録済みパスには推測不能なIDの`app://external-assets/` URLを発行し、RangeとHEADに対応したストリームで配信します。原本全体の`readFile()`や、実パスを直接指定するURLは使用しません。UIのIPC操作はメインウィンドウの送信元を検証します。モード・履歴・読み取り失敗の扱いは[アセット仕様](../../../docs/assets.md)を参照してください。

通常のテストは範囲読み取り・再解決・パス・原本書き出しを検証します。`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/external-assets-electron.test.mjs`を実行すると、非表示のElectronウィンドウでPlayer再生とWorkerからの動画デコードも確認できます。

## 最近使用したプロジェクト

WindowsとmacOSでは、プロジェクトを開く・保存する操作が成功してアプリ内の履歴へ記録した際に、`app.addRecentDocument()`でOSの履歴にも登録します。Windowsではタスクバーのジャンプリスト、macOSではDockアイコンの右クリックメニューから、最近の`.gsproj`を開けます。[Electronの仕様](https://www.electronjs.org/docs/latest/tutorial/recent-documents)も参照してください。

Windowsではファイルのパスを起動引数として受け取り、新しいプロセスの別ウィンドウへ読み込みます。ジャンプリストの表示には拡張子の関連付けが必要です。NSISインストーラーが`.gsproj`の関連付けを登録するため、表示と再オープンの確認はインストールした配布版で行ってください。開発版は配布版と異なるAppUserModelIDを使います。Windowsの履歴表示設定によっては項目が表示されません。

macOSでは`open-file`イベントを`ready`より前から購読します。`ProjectLaunchController`が初期化前の要求を保持し、最初のファイルを起動ウィンドウへ一度だけ渡します。編集ウィンドウがある場合は、編集中の作品を保つためアプリの実行ファイルを直接起動して別プロセスで開きます。全ウィンドウを閉じた後の要求では、既存プロセスにウィンドウを作ります。IPCは現在のウィンドウに割り当てた起動ファイルを取得するため、再表示後にも使用できます。ファイル指定なしの再表示では以前の作品を自動で開きません。electron-builderの共通設定で`.gsproj`をmacOSの書類型にも登録します。Dockの表示・Finderからの起動・複数ファイルのオープン・全ウィンドウを閉じた後の再オープンはmacOSにインストールした配布版でも確認してください。

アプリ内の履歴は最新20件を保持し、OSの履歴の表示件数・並び順などは各OSが管理します。アプリ内での個別削除はアプリ内の履歴だけに反映し、全履歴の消去時は`app.clearRecentDocuments()`も呼び出します。終了時には消去せず、次回起動時にも履歴を利用できます。OSへの登録・消去が失敗してもアプリ内の履歴操作は完了し、失敗をmainのログへ記録します。

## 自動更新

配布版のWindowsアプリだけで起動時に1回確認します。開発起動と他OSでは無効です。Helpメニューから手動で再確認できます。確認に失敗しても起動を妨げず、手動確認時にエラーを表示します。

`github-updates.mjs`は公開リポジトリ`syuilo/glitch-studio`のGitHub Releases APIを使い、公開済みの`v<SemVer>`タグから対象を選びます。正式版はより新しい正式版だけ、開発版はalpha・beta・rcなどの段階を問わず、より新しい開発版と正式版を対象にします。公開日時よりSemVerの大小を優先し、Draftとダウングレードは除外します。APIのレート制限・通信失敗は確認失敗として扱い、認証トークンを配布物へ含めません。

対象ReleaseのダウンロードURLをelectron-updaterのgeneric providerへ渡し、`latest.yml`の取得・SHA-512検証・ダウンロード・NSIS実行を委ねます。GitHub providerの既定の開発段階による選別では、上記の更新方針を表現できないためです。配布側はすべての版で`latest.yml`を生成します。

`DesktopUpdateController`が状態と終了許可を所有します。自動ダウンロードと通常終了時の自動インストールは無効です。preloadは状態取得・購読・確認・準備・開始・準備失敗の解除だけを公開し、mainが呼び出し元のメインフレームを検証します。UIから配布URLやインストーラーのパスは受け取りません。共有状態の型は`@gs/glitch-studio_shared/desktop-update.ts`です。

更新時は次の順に進みます。

1. ヘッダとHelpメニューの通知を選択する。
2. 対象バージョン、キャンセル不可、再起動による未保存の変更消失に同意する。
3. 閉じられない更新ダイアログを表示し、mainで更新の排他を取得する。
4. `ApplicationActivity`で読込・書き出しとの競合を拒否する。手動保存・自動バックアップの新規受付を停止し、受付済みの保存キューの完了を待つ。
5. プレビューを停止し、ダウンロードと検証を実行する。
6. インストーラーへ引き継ぐ直前にだけ終了を許可し、`quitAndInstall(true, true)`でサイレント更新と更新後の起動を要求する。

処理中はEsc・背景クリック・通常のウィンドウ終了・リロード操作で中断できません。Vueのダイアログを表示できるのは元プロセスが終了するまでです。ダウンロード失敗やインストーラーへの引き継ぎ前の失敗では、保存とプレビューを復帰してから「閉じる」「再試行」を表示します。実行中だった保存が失敗した場合も更新を中止します。再試行では改めて確認します。

インストーラーの起動を試みた後の失敗は`restart-required`として保持します。electron-updaterの内部状態を直接変更せず、「閉じる」と再起動が必要な旨の案内を表示します。確認・準備のIPCを呼び直しても同じプロセスでは再試行できません。必要な内容を保存してGlitch Studioを終了し、起動し直してから再試行します。インストーラーを呼ぶ前の引き継ぎ情報の保存失敗は、通常の再試行が可能です。

元プロセスが終了した後のインストール障害は、元のVue画面へ報告できません。その場合はインストーラー側の表示やログを確認し、必要に応じてReleaseから手動インストールします。

## 複数プロセス

ファイル関連付けから別のプロジェクトを開く既存の動作を維持します。`DesktopInstances`がユーザーデータ領域へ同じ実行ファイルの各プロセスを登録し、それぞれの生存を専用の名前付きパイプで確認します。更新の受付と新規起動の登録には共通の名前付きパイプによる排他を使い、別プロセスがある間は更新開始を拒否します。更新中に起動したプロセスは案内を表示して終了します。

登録ファイルは一時ファイルからrenameして確定し、異常終了による途中のJSONを読ませません。古い登録はパイプの生存確認後に整理します。更新元の終了後は引き継ぎ情報を残し、旧版の新規起動を30秒間とインストーラーの実行中に拒否します。新版の起動、または猶予後にインストーラーが終了している場合は解除するため、失敗後にも起動し直せます。

## リリース

GitHub Actionsの**Release**を選び、ブランチを`master`として実行します。`version_mode`で明示指定または現在のバージョンのインクリメントを選びます。

| version_mode | 動作 | 例 |
| --- | --- | --- |
| `explicit`（既定） | `version`へリリース番号を入力する | `2.0.0-beta.1`を入力 |
| `prerelease` | 既存の開発段階を維持して開発版番号を増やす | `2.0.0-alpha.4` → `2.0.0-alpha.5` |
| `patch` | node-semverのpatch増分 | `1.2.3` → `1.2.4` |
| `minor` | node-semverのminor増分 | `1.2.3` → `1.3.0` |
| `major` | node-semverのmajor増分 | `1.2.3` → `2.0.0` |

`explicit`の場合だけ`version`を入力し、それ以外では空欄にします。`v`接頭辞や`+build`メタデータは使用できません。開発版か正式版かは確定したSemVerの開発版識別子から判断します。

増分の起点は、dispatch時点で固定したコミットのルート`package.json`です。GitHub Releasesの公開順や実行待ちの間に進んだmasterは参照せず、元の実行を再実行しても二重に増分しません。確定したバージョンはprepareジョブの出力として各OSのビルドと公開ジョブへ渡します。

`prerelease`は現在が開発版の場合だけ使用できます。正式版から開発版を始める場合やalphaからbetaなどへ段階を変える場合は、`explicit`で番号を指定してください。`patch`・`minor`・`major`は[node-semverの規則](https://github.com/npm/node-semver#functions)に従い、開発版を正式版へ昇格させる場合があります。例えば`2.0.0-alpha.4`では、いずれも`2.0.0`になります。

Workflowは以下を実行します。

1. dispatch時点の`github.sha`を固定する。実行待ちやビルド中の追加コミットは含めない。
2. 選択した方法でバージョンを確定し、ルート`package.json`をその番号へ変更する。Workflow実行の`createdAt`を取得して日本時間の公開日を決め、`docs-site/guide/download.md`のリンク・表示バージョン・公開日も更新する。すべてを一つのリリース用コミットに含める。UIの表示バージョンとElectronのバージョンはこの値を使う。
3. lint・型チェック・テスト・ドキュメントのビルドを実行する。未公開のリリースコミットをGit bundleで各ビルドジョブへ渡し、WindowsランナーでNSIS、macOSランナーでarm64・x64のDMGを生成する。ASARの依存、macOSアプリの署名とDMGの整合性も検証する。
4. masterが元のコミットのままであることを確認し、リリース用コミットと`v<version>`タグをatomic pushする。force pushは使わない。
5. Draft ReleaseへSetup.exe・`.blockmap`・`latest.yml`・`Glitch-Studio-<version>-mac-arm64.dmg`・`Glitch-Studio-<version>-mac-x64.dmg`をアップロードし、ダウンロードし直してローカルの成果物と比較する。すべてのOSの成果物を必須とする。
6. すべて成功した場合だけ公開する。開発版はpre-releaseとし、正式版だけGitHubのLatestへ指定する。
7. 公開成功後、`deploy-pages`ジョブから既存のPages Workflow（`deploy.yml`）を`master`指定で起動し、アプリとドキュメントをまとめてデプロイする。デプロイ自体は別のWorkflowとして実行する。

ダウンロードページでは`DOWNLOAD_LINK_MARKER: windows`・`DOWNLOAD_LINK_MARKER: macos`・`CURRENT_VERSION_MARKER`・`CURRENT_VERSION_RELEASE_DATE_MARKER`の開始・終了コメントをそれぞれ一組ずつ保持してください。Windowsはx64インストーラー、macOSはApple Silicon（arm64）とIntel（x64）のDMGへリンクします。表示バージョンの`v`接頭辞はマーカー外の本文に置きます。正式版・開発版ともリリース対象のバージョンへ更新します。マーカー外の本文は変更せず、マーカーの欠落・重複・入れ子は公開前にエラーにします。

公開日は初回のWorkflow実行の作成日時（`gh run view`の`createdAt`）を日本時間（Asia/Tokyo）の`YYYY-MM-DD`へ変換した日付です。実際のRelease公開が翌日になっても開始日のままとします。同じ実行の再実行では`createdAt`が変わらず、既存の未公開タグを再利用する場合もコミット済みの日付を保ちます。公開後の追加コミットは作りません。

ビルド中にmasterが進んだ場合は公開せず失敗します。最新のmasterに対して新しくWorkflowを実行してください。タグ作成後に公開が失敗した場合は、元の実行を再実行すると同じリリースコミットを使い、未公開のDraftへ再アップロードできます。すでに公開済みのバージョンや異なるソースのタグは拒否します。公開済みの成果物を差し替える修正はせず、新しいバージョンとしてリリースしてください。

準備ジョブの`GITHUB_TOKEN`には実行日時を取得するための`actions: read`と`contents: read`、公開ジョブには`contents: write`、Pages起動ジョブには`actions: write`が必要です。masterやタグの保護ルールでpushが拒否される場合は、そのルールに合わせた運用が必要です。`GITHUB_TOKEN`によるpushでは通常のpush起点の別Workflowは開始しないため、Release公開成功後に明示的な`workflow_dispatch`でPagesを起動します。Pagesの起動依頼だけが失敗した場合は`deploy-pages`ジョブだけを再実行できます。Pagesのビルド・デプロイに失敗した場合は、既存のPages Workflowを再実行してください。

## コード署名と検証

Windows版は未署名です。更新のハッシュ検証は行いますが、署名による発行元の検証は行えません。WindowsのSmartScreen・Smart App Controlや組織のポリシーにより、警告や実行拒否が発生することがあります。

macOS版はApple Developer証明書を使わず、`identity: '-'`でad-hoc署名を付けます。Hardened Runtimeと公証は無効です。ad-hoc署名はApple Siliconでの実行に必要なコードの整合性を保つもので、発行元の信頼性を証明しません。Gatekeeperにより起動が制限される場合は、信頼できる配布元であることを確認したうえでmacOSの「プライバシーとセキュリティ」から実行を許可します。組織のポリシーによっては実行できません。

macOS版の更新はReleaseからDMGをダウンロードして手動で行います。macOSの自動更新にはDeveloper IDによる署名などの整備が必要なため、`latest-mac.yml`や更新用ZIPは生成せず、アプリ内の更新機能も無効のままです。

署名を導入する場合はelectron-builder側へ署名方式を設定し、最終署名済み成果物からメタデータを生成します。発行元の検証と`forceCodeSigning`も有効にし、署名失敗を未署名配布へ切り替えないでください。

desktopのテストは更新の状態遷移・IPCの送信元・実パイプの排他・開発版選択・ASARと成果物の検証を行います。UIのテストは状態購読・閉じられないダイアログ・保存キューの完了待ちと失敗後の復帰を確認します。Windowsではルートの`pnpm typecheck`をサンドボックス外で実行してください。

実際のRelease公開とインストール済みアプリの置き換えを伴う確認は、テスト用環境で旧版をインストールしてから実施します。通常更新、通信失敗後の再試行、別プロセスの拒否、保存中の開始、未保存変更の警告、更新後の再起動を確認してください。
