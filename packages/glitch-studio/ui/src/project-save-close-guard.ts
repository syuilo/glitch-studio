import { watch } from 'vue';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

/** 保存状態を終了処理へ反映し、Appの破棄時に解除できるようにする。 */
export function installProjectSaveCloseGuard(isProjectSaving: Readonly<Ref<boolean>>, hasUnsavedChanges: Readonly<Ref<boolean>>): () => void {
	let showingCloseNotice = false;
	const onBeforeUnload = (event: BeforeUnloadEvent) => {
		if (!isProjectSaving.value) {
			if (!__ELECTRON__ || !hasUnsavedChanges.value) return;
			// beforeunloadでは非同期の返答を待てないため、OSの確認結果を同期的に受け取る。
			// 元の終了要求をそのまま継続することで、macOSのアプリ終了や再読み込みにも対応する。
			if (window.desktop?.confirmProjectClose({
				message: i18n.ts._App.ConfirmCloseUnsavedProject,
				detail: i18n.ts._App.UnsavedChangesWillBeLost,
				closeButtonLabel: i18n.ts._App.CloseWithoutSaving,
				cancelButtonLabel: i18n.ts.Cancel,
			}) === true) return;
			event.preventDefault();
			event.returnValue = true;
			return;
		}
		event.preventDefault();
		// Electronでは終了を取り消し、Web版ではブラウザー標準の終了確認を表示する。
		// Web版の確認文言は変更できず、ユーザーが終了を選ぶことも禁止できない。
		event.returnValue = true;
		if (__ELECTRON__ && !showingCloseNotice) {
			showingCloseNotice = true;
			void ui.alert({ type: 'info', title: i18n.ts._App.ProjectSaving, text: i18n.ts._App.CannotCloseWhileSaving })
				.finally(() => { showingCloseNotice = false; });
		}
	};
	// Electron版は終了要求の時点で未保存状態を評価する。
	// 編集のたびにスナップショットを比較するためのwatchは追加しない。
	if (__ELECTRON__) window.addEventListener('beforeunload', onBeforeUnload);
	// クリック直後から保護し、保存完了直後の終了も妨げないよう同期的に切り替える。
	const stopWatching = __ELECTRON__ ? null : watch(isProjectSaving, saving => {
		if (saving) window.addEventListener('beforeunload', onBeforeUnload);
		else window.removeEventListener('beforeunload', onBeforeUnload);
	}, { immediate: true, flush: 'sync' });
	return () => {
		stopWatching?.();
		window.removeEventListener('beforeunload', onBeforeUnload);
	};
}
