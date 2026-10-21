import { watch } from 'vue';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

/** 保存状態を終了処理へ反映し、Appの破棄時に解除できるようにする。 */
export function installProjectSaveCloseGuard(isProjectSaving: Readonly<Ref<boolean>>, hasUnsavedChanges: Readonly<Ref<boolean>>): () => void {
	let showingCloseNotice = false;
	let disposed = false;
	let allowNextUnload = false;
	let unloadBlockedBySaving = false;
	let activeRequestId: number | null = null;
	const desktop = __ELECTRON__ ? window.desktop ?? null : null;
	const stopListening = desktop?.onProjectCloseRequested(requestId => {
		activeRequestId = requestId;
		void (async () => {
			let confirmed = false;
			try {
				// 保存中に止めた終了は、保存が先に完了しても自動では再開しない。
				if (!disposed && !unloadBlockedBySaving && !isProjectSaving.value) {
					const result = hasUnsavedChanges.value ? await ui.confirm({
						type: 'warning',
						title: i18n.ts._App.ConfirmCloseUnsavedProject,
						text: i18n.ts._App.UnsavedChangesWillBeLost,
						okText: i18n.ts._App.CloseWithoutSaving,
						cancelText: i18n.ts.Cancel,
						autofocusAction: 'cancel',
					}) : { canceled: false };
					confirmed = !result.canceled && !disposed && !isProjectSaving.value;
				}
			} catch (error) {
				console.error('Failed to confirm project closing:', error);
			}
			try {
				// 確認済みの要求の再実行だけを一度許可する。保存中の終了禁止は引き続き優先する。
				allowNextUnload = confirmed;
				if (!await desktop.completeProjectClose(requestId, confirmed)) allowNextUnload = false;
			} catch (error) {
				allowNextUnload = false;
				console.error('Failed to resume project closing:', error);
			} finally {
				if (activeRequestId === requestId) activeRequestId = null;
			}
		})();
	});
	const onBeforeUnload = (event: BeforeUnloadEvent) => {
		const confirmed = allowNextUnload;
		allowNextUnload = false;
		unloadBlockedBySaving = isProjectSaving.value;
		if (!isProjectSaving.value && (confirmed || !__ELECTRON__ || !hasUnsavedChanges.value)) return;
		event.preventDefault();
		// Electronでは終了を取り消し、Web版ではブラウザー標準の終了確認を表示する。
		// Web版の確認文言は変更できず、ユーザーが終了を選ぶことも禁止できない。
		event.returnValue = true;
		if (__ELECTRON__ && isProjectSaving.value && !showingCloseNotice) {
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
		disposed = true;
		stopListening?.();
		if (activeRequestId != null) void desktop?.completeProjectClose(activeRequestId, false).catch(console.error);
		stopWatching?.();
		window.removeEventListener('beforeunload', onBeforeUnload);
	};
}
