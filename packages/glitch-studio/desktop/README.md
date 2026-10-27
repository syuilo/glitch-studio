# Electron版

Windows x64向けのNSISインストーラーと、macOSのApple Silicon（arm64）・Intel（x64）向けのDMGを配布します。開発起動はルートで`pnpm dev:desktop`を実行します。公開しない配布ビルドは、Windows上では`pnpm dist:desktop:win`、macOS上では`pnpm dist:desktop:mac`を実行します。macOSのコマンドは両アーキテクチャを生成します。出力先はルートの`release/`です。

desktopのパッケージ名は`@gs/glitch-studio_desktop`です。electron-builderがpnpmのworkspace一覧から実行時依存を収集する際にも使われるため、ルートと同名にしたり省略したりしないでください。`afterPack`では、ASAR内のnpmの実行時依存に加え、エントリ・preload・配布対象ファイルから静的にたどれる相対import・require先の存在も再帰的に検査します。新しい実装ファイルを追加した場合は、`electron-builder.config.cjs`の`applicationFiles`へ追加してください。実際の設定とソースをASARに詰める回帰テストでも、配布対象への追加漏れを検出します。

## 起動時の表示

`startup-splash.mjs`が`BaseWindow`と`ImageView`を使い、`resources/startup-splash.png`を直接表示します。ロゴと文字は事前に画像化しており、スプラッシュ専用のレンダラープロセスやHTMLの読み込み・初回描画を待ちません。Electronの`app.ready`以降に表示でき、`ImageView`は実験的APIです。画像は`app.asar`内に同梱するため、開発版・配布版で同じものを使用します。

メインウィンドウは`ready-to-show`の後も0.5秒間非表示にして、UIの初期レイアウトが落ち着く猶予を設けます。その間はスプラッシュを表示し続け、待機後にメインウィンドウを最大化して表示すると同時にスプラッシュを閉じます。メインウィンドウが表示済みの場合はスプラッシュを作成しません。起動途中でメインウィンドウを閉じた場合は表示タイマーを解除してスプラッシュも破棄し、画像の読み込み失敗は通常の起動を妨げません。

`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/startup-splash-electron.test.mjs`を実行すると、実ウィンドウを短時間表示してレンダラープロセスを増やさない表示と切り替え・起動途中の終了・読み込み失敗を検証します。

## パネルとプレビューの別ウィンドウ

Windowメニューから開くパネルと、既存パネル・プレビューを切り離したウィンドウは、メインウィンドウを`parent`に指定して開きます。メイン画面を操作しても、その子ウィンドウはメイン画面より前面に表示されます。モーダルにはしないため、両方の画面を操作できます。Web版の通常の別ウィンドウには、この前面固定は適用できません。

メイン画面と別ウィンドウは、`titleBarStyle: 'hidden'`と高さ32pxの`titleBarOverlay`を共通で使います。UIの`GsWindowTitlebar.vue`が背景とドラッグ領域を描き、別ウィンドウでは`GsDetachedWindowFrame.vue`がアイコン・パネル名と残りのコンテンツ領域を配置します。最小化・最大化・閉じる操作はOSのボタンを使い、CSSの`titlebar-area-*`でその領域を避けます。Web版とDocument PiPには独自タイトルバーを追加しません。

編集ウィンドウごとにrenderer・AppContext・ProjectContext・描画と音声のWorkerを所有します。バックグラウンドへ移しただけでは再生・書き出しを停止せず、`backgroundThrottling: false`でウィンドウの描画タイマーを抑制させません。GPU負荷のプロジェクト間調整や音声の排他的な再生は行いません。

## 計測精度

`app-protocol.mjs`がアプリのHTMLとWorkerを含む静的ファイルへCOOP・COEPヘッダーを付け、`performance.now()`の丸めを緩和します。開発起動ではViteのヘッダー設定を使用します。`contextIsolation`とは別の仕組みで、sandboxとNode.jsの無効化は維持します。

mainプロセスは`ready`より前に`enable-webgpu-developer-features`を指定し、GPU timestamp queryの量子化も解除します。このChromiumの開発者向け設定は、WebGPUの追加の開発者向け機能も公開します。計測の実際の分解能はGPU・ドライバーに依存します。

Web版の公開先に必要な設定や素材の読み込み条件は[Web版の配信と計測精度](../../../docs/web-deployment.md)を参照してください。

## 未保存の変更の終了確認

UIが終了・再読み込み時に未保存の変更を判定して`beforeunload`を取り消し、`project-close-guard.mjs`の`ProjectCloseController`が`will-prevent-unload`後にVueの確認を要求します。ウィンドウ終了・アプリ終了・再読み込みのどれだったかと要求IDをmainが保持し、連続した操作ではダイアログを重ねません。UIからの非同期IPCは送信元と要求IDを検証し、「保存せずに閉じる」を選んだ場合だけ元の操作を再開します。キャンセル・Esc・表示失敗・画面破棄で終了を許可せず、保存中・エクスポート中は未保存変更の確認より終了防止を優先します。エクスポート中の終了要求は案内を表示して拒否し、完了しても自動では再開しません。確認済みの自動更新による終了では重ねて確認せず、更新準備・ダウンロード中の終了防止も維持します。

`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/project-close-guard-electron.test.mjs`を実行すると、非表示のElectronウィンドウで終了の取消・許可、再読み込み、保存中・エクスポート中の保護、更新時の確認省略、アプリ終了を検証します。確認UIの表示先と返答だけを置き換え、実際のpreloadとUI・main間の非同期IPCを使います。

アプリ全体の終了でも、各編集ウィンドウが個別に未保存変更を確認し、同意した画面から閉じます。途中で取り消した場合、既に閉じた画面は戻しません。各画面の返答ではその画面だけを閉じ、全体終了を再発行しないため、別の画面で取り消した終了要求を再開しません。保存中・書き出し中の画面は終了を拒否し、完了後に改めて終了を操作します。`ProjectCloseController`は要求IDと全体終了の意図を保持し、再読み込み・画面破棄で古い要求を失効させます。通常のウィンドウ終了はその作品と子ウィンドウだけを閉じ、Windowsでは最後の編集ウィンドウでアプリを終了します。macOSでは通常のウィンドウ終了後もアプリを残し、全体終了を要求して最後の画面を閉じた場合はアプリ本体も終了します。Dockからの再表示で編集画面がなければダッシュボードを開きます。

## 外部参照アセット

`external-assets.mjs`は原本の可読性確認、パスの相対化・解決、原本書き出しを担当します。登録済みパスには推測不能なIDの`app://external-assets/` URLを発行し、RangeとHEADに対応したストリームで配信します。原本全体の`readFile()`や、実パスを直接指定するURLは使用しません。UIのIPC操作はメインウィンドウの送信元を検証します。モード・履歴・読み取り失敗の扱いは[アセット仕様](../../../docs/assets.md)を参照してください。

通常のテストは範囲読み取り・再解決・パス・原本書き出しを検証します。`GLITCH_ELECTRON_TEST=1`で`node --test packages/glitch-studio/desktop/test/external-assets-electron.test.mjs`を実行すると、配布用`app://`・Vite開発・ViteプレビューでWindowとWorkerの隔離、動画再生とデコード、画像のCORS読み込み、別ウィンドウでの描画も確認できます。

## 編集コマンド

`edit-command-ipc.mjs`は送信元のメインウィンドウを検証し、`copy`・`paste`・`cut`・`delete`だけを`webContents`の対応する編集メソッドへ渡します。preloadは`executeEditCommand`を公開します。文字列の読み書きやキーイベントの合成は行わず、入力欄の選択範囲・入力通知・Undo履歴はChromiumが管理します。タイムラインやグラフのcopy・paste・cutは、発生したDOMイベントをUI側で処理します。

## 最近使用したプロジェクト

WindowsとmacOSでは、プロジェクトを開く・保存する操作が成功してアプリ内の履歴へ記録した際に、`app.addRecentDocument()`でOSの履歴にも登録します。Windowsではタスクバーのジャンプリスト、macOSではDockアイコンの右クリックメニューから、最近の`.gsproj`を開けます。[Electronの仕様](https://www.electronjs.org/docs/latest/tutorial/recent-documents)も参照してください。

Windowsではファイルのパスを起動引数として受け取り、同じメインプロセス内の別の編集ウィンドウへ読み込みます。ジャンプリストの表示には拡張子の関連付けが必要です。NSISインストーラーが`.gsproj`の関連付けを登録するため、表示と再オープンの確認はインストールした配布版で行ってください。開発版は配布版と異なるAppUserModelIDを使います。Windowsの履歴表示設定によっては項目が表示されません。

macOSでは`open-file`イベントを`ready`より前から購読します。`FileLaunchController`が初期化前の要求を保持し、各ファイルを同じメインプロセス内の別の編集ウィンドウへ渡します。全ウィンドウを閉じた後の要求でも新しいウィンドウを作ります。IPCは各ウィンドウに割り当てた起動ファイルを一度だけ取得します。Dockからの再表示は最後に使用した編集画面を表示し、以前の作品を自動では読み込みません。electron-builderの共通設定で`.gsproj`をmacOSの書類型にも登録します。Dockの表示・Finderからの起動・複数ファイルのオープン・全ウィンドウを閉じた後の再オープンはmacOSにインストールした配布版でも確認してください。

アプリ内の履歴は最新20件を保持し、OSの履歴の表示件数・並び順などは各OSが管理します。アプリ内での個別削除はアプリ内の履歴だけに反映し、全履歴の消去時は`app.clearRecentDocuments()`も呼び出します。終了時には消去せず、次回起動時にも履歴を利用できます。OSへの登録・消去が失敗してもアプリ内の履歴操作は完了し、失敗をmainのログへ記録します。

履歴の保存先は全編集ウィンドウで共有し、一覧はダッシュボードを開くたびに取得します。他の画面での変更は開きっぱなしの一覧へ自動同期しません。その画面で履歴を登録・削除・全消去した場合は、操作後に一覧を更新します。

## 画像・動画をOSから開く

配布版では、Windowsの「プログラムから開く」とmacOSのFinderの「このアプリケーションで開く」から画像・動画を開けます。対象はPNG・JPEG（jpg/jpeg）・GIF・WebP・AVIF・BMP、およびMP4・M4V・MOV・WebM・MKVです。動画はコンテナ内のコーデックによってデコードできない場合があります。画像は既存のImageノード、動画は既存のVideoノードとタイムラインのVideoレイヤーを含む新規プロジェクトとして開きます。GIFなどの画像の扱いも通常の画像取り込みと同じです。

Windowsの素材登録は`resources/installer.nsh`が担当します。electron-builderの標準関連付けは拡張子の既定値も書くため、画像・動画には使いません。インストールのスコープに従った`Software\Classes`へ専用の`GlitchStudio.Media` ProgIDと`OpenWithProgids`を登録し、既定のアプリや`UserChoice`は変更しません。アンインストール時はGlitch Studioの素材登録だけを削除します。macOSは`fileAssociations`で`Editor`・`Alternate`として公開します。`.gsproj`の関連付けは従来どおりです。

`startup-files.mjs`がWindowsの起動引数を解析し、`file-launch.mjs`の`FileLaunchController`がmacOSの`open-file`を含めて要求を調整します。複数ファイルは1ファイルにつき1つの編集ウィンドウへ分離します。`startup-file-ipc.mjs`は`desktop:take-startup-file`でプロジェクトのハンドル、または素材のパスとMIMEを一度だけ返します。素材はプロジェクトの保存先へ登録しないため、Saveでは新しく`.gsproj`の保存先を選び、原本を上書きしません。素材の取り込みでは通常の埋め込み・外部参照設定と30MBの自動切り替え設定を適用します。読み込み失敗時はエラーを表示してダッシュボードへ戻ります。

公開形式と受け付ける形式は`media-file-types.cjs`で定義し、NSISの拡張子一覧との一致はテストで確認します。OSのメニュー表示・既定アプリの維持・空白や日本語を含むパス・複数選択・アンインストール後の登録解除は、各OSのインストール済み配布版でも確認してください。

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

## 単一メインプロセスと複数の編集ウィンドウ

同じユーザープロファイルのメインプロセスは`requestSingleInstanceLock()`で一つに制限します。追加プロセスは起動要求を転送して終了し、`second-instance`とmacOSの`open-file`から新しい編集ウィンドウを開きます。ファイル指定なしの明示的な追加起動は新しいダッシュボードを開きます。共有のSessionを一つのメインプロセスから利用するため、localStorageとGPUキャッシュを複数のメインプロセスで同時に開きません。開発版は`Glitch Studio Development`のプロファイルを使い、配布版の設定と起動ロックを共有しません。

`editor-windows.mjs`の`EditorWindows`は送信元のメインフレームとオリジンを検証し、IPCを対象の編集画面へ振り分けます。ProjectFiles・ExportFiles・VOICEVOX接続・起動ファイル・終了確認・書き出し通知はウィンドウごとに所有します。最近のプロジェクトと更新状態は共有します。閉じた画面のファイルIDや書き出し途中の一時ファイルは解放し、別の作品の操作には使用できません。

読み込み中を含め、同じ保存先ファイルは一つの編集画面だけが所有します。重複オープンは所有者を表示し、他の作品の別名保存先としての選択を拒否します。読み込み失敗・取消では予約だけを解除し、正常に開く・保存する操作の成功後に現在の保存先を切り替えます。アプリ内で別作品を開く・新規作成するときは、現在の未保存変更の破棄を確認します。

UIの読み込み失敗やrendererの異常終了では、その画面に再読み込み・終了を案内し、他の作品は終了させません。未保存状態の自動復元は行いません。`GLITCH_ELECTRON_TEST=1`で`test/editor-windows-electron.test.mjs`を実行すると、実際のmain・preload・rendererで追加起動、言語と設定の保存値を新規画面へ適用する動作、既存画面の設定の独立性、ファイルIDの分離、重複オープン、切り離しウィンドウ、異常終了、全体終了での個別確認と途中取消を非表示で検証します。

更新は編集ウィンドウが一つの場合だけ開始でき、切り離しパネルは件数へ含めません。準備開始後の新規ウィンドウ・ファイルオープンは拒否します。`DesktopInstances`の名前付きパイプによる排他と登録は、インストーラーへの引き継ぎと更新中の再起動の保護に引き続き使用します。

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
3. ドキュメントのビルドを実行する。未公開のリリースコミットをGit bundleで各ビルドジョブへ渡し、WindowsランナーでNSIS、macOSランナーでarm64・x64のDMGを生成する。ASARの依存、macOSアプリの署名とDMGの整合性も検証する。
4. masterが元のコミットのままであることを確認し、リリース用コミットと`v<version>`タグをatomic pushする。force pushは使わない。
5. Draft ReleaseへSetup.exe・`.blockmap`・`latest.yml`・`Glitch-Studio-<version>-mac-arm64.dmg`・`Glitch-Studio-<version>-mac-x64.dmg`をアップロードし、ダウンロードし直してローカルの成果物と比較する。すべてのOSの成果物を必須とする。
6. すべて成功した場合だけ公開する。開発版はpre-releaseとし、正式版だけGitHubのLatestへ指定する。
7. 公開成功後、`deploy-pages`ジョブから既存のPages Workflow（`deploy.yml`）を`master`指定で起動し、アプリとドキュメントをまとめてデプロイする。デプロイ自体は別のWorkflowとして実行する。

lint・型チェックはLint Workflow、テストはTest Workflowで実行します。

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

実際のRelease公開とインストール済みアプリの置き換えを伴う確認は、テスト用環境で旧版をインストールしてから実施します。通常更新、通信失敗後の再試行、複数編集ウィンドウでの更新拒否、保存中の開始、未保存変更の警告、更新後の再起動を確認してください。
