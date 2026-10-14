# UIのドラッグセッション

HTML Drag and Dropによるアプリ内ドラッグは、`utility/drag-and-drop.ts`の共通セッションで扱います。タイムラインの時間移動・トリムなど、PointerEventを追跡する操作はこの仕組みの対象外です。

## データと寿命

`composables/useDragSession.ts`は各開始元に識別IDを割り当て、アンマウント時にその開始元のセッションを終了します。`start(event, type, data)`は型付きデータをDataTransferに保存し、同じJSONのスナップショットをメモリにも保持します。セッションごとの識別子もDataTransfer.typesに載せるため、種別だけが一致する外部ドラッグや古いイベントを現在の内部ドラッグとして扱いません。

`read(event, type)`はdragover中にもスナップショットを参照できます。`readSource(event, type)`は同じインスタンスで開始したドラッグに限定します。drop時にはブラウザ側のJSONとの一致も確認し、書き換わったデータを古いキャッシュで補いません。

UI用の`data(type)`と`sourceData(type)`はComputedRefです。dragoverの読み出しは開始直後から可能ですが、DOM変更によってChromeのドラッグが中断されることを避けるため、リアクティブな公開は10ms遅らせます。各コンポーネントはドラッグ元IDや受付領域をここから算出し、独自の開始・終了状態を持ちません。

開始元ウィンドウのdragend・blur・次のdragstart、開始元のアンマウントでデータ・タイマー・リスナーを解放します。dropではcaptureで終了を観測しても、全ハンドラーが読み終わるよう次のタスクまで破棄を待ちます。別ウィンドウの受付がdropデータを参照した場合も同じ終了処理を予約します。古いセッションの終了処理が新しいセッションを消すことはありません。

`complete(event)`は受付確定時に呼び出します。異なるインスタンスへの移動では、`start`の第4引数のコールバックを一度だけ呼び、開始元へ元要素の削除を通知します。同一インスタンスでの並び替えやキャンセルでは通知しません。コールバックはメモリ上のセッションが所有し、DataTransferには入れません。

## 利用箇所

- GsTimelineは`readSource`で同じTimeline内の並び替えだけを受け付け、`sourceData`から仮想スクロールに保持するレイヤーIDを算出します。挿入位置・階層の判定とCommandによる移動はTimelineが所有します。
- GsDraggableは`data`で同じグループのドラッグ領域を表示し、空一覧への移動にも同じグループ条件を適用します。確定コールバックでインスタンス間の移動元を更新します。対象外のファイルイベントは伝播を止めず、App.vueの全体受付へ渡します。
- GsWorkspacePanel・GsWorkspaceDividerはWorkspacePanelのセッションを共有し、パネル移動・交換を行います。app.tsに専用のドラッグ状態は置きません。
- GsAssetはAsset IDをセッションへ渡し、Timeline・Visual Module Editorの素材受付が`getActiveDragData`で参照します。共通の`useAssetDrop`がホバー表示とファイル／Assetの受付を行い、対象イベントをAppや内部の並び替えへ伝播させません。

外部ファイルはセッションに載せず、イベント中にDataTransfer.filesを保存して取り込み処理へ渡します。`setDragData`・`getDragData`・`checkDragDataType`はDataTransfer自体を扱う低水準のユーティリティとして残します。
