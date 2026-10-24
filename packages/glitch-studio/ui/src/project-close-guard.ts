import { computed, watch } from 'vue';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

/** 保存・書き出し・未保存の変更を終了処理へ反映し、Appの破棄時に解除する。 */
export function installProjectCloseGuard(isProjectSaving: Readonly<Ref<boolean>>, isExporting: Readonly<Ref<boolean>>, hasUnsavedChanges: Readonly<Ref<boolean>>): () => void {
	const isCloseBlocked = computed(() => isProjectSaving.value || isExporting.value);
	let showingCloseNotice = false;
	let disposed = false;
	let allowNextUnload = false;
	let unloadBlockedByOperation = false;
	let activeRequestId: number | null = null;
	const desktop = __ELECTRON__ ? window.desktop ?? null : null;
	const stopListening = desktop?.onProjectCloseRequested(requestId => {
		activeRequestId = requestId;
		void (async () => {
			let confirmed = false;
			try {
				// 保存・書き出し中に止めた終了は、処理が先に完了しても自動では再開しない。
				if (!disposed && !unloadBlockedByOperation && !isCloseBlocked.value) {
					const result = hasUnsavedChanges.value ? await ui.confirm({
						type: 'warning',
						title: i18n.ts._App.ConfirmCloseUnsavedProject,
						text: i18n.ts._App.UnsavedChangesWillBeLost,
						okText: i18n.ts._App.CloseWithoutSaving,
						cancelText: i18n.ts.Cancel,
						autofocusAction: 'cancel',
					}) : { canceled: false };
					confirmed = !result.canceled && !disposed && !isCloseBlocked.value;
				}
			} catch (error) {
				console.error('Failed to confirm project closing:', error);
			}
			try {
				// 確認済みの要求の再実行だけを一度許可し、保存・書き出し中の終了禁止を優先する。
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
		unloadBlockedByOperation = isCloseBlocked.value;
		if (!isCloseBlocked.value && (confirmed || !__ELECTRON__ || !hasUnsavedChanges.value)) return;
		event.preventDefault();
		// Electronでは終了を取り消し、Web版ではブラウザー標準の終了確認を表示する。
		// Web版の確認文言は変更できず、ユーザーが終了を選ぶことも禁止できない。
		event.returnValue = true;
		if (__ELECTRON__ && isCloseBlocked.value && !showingCloseNotice) {
			showingCloseNotice = true;
			void ui.alert({ type: 'info',
				title: isProjectSaving.value ? i18n.ts._App.ProjectSaving : i18n.ts._App.Exporting,
				text: isProjectSaving.value ? i18n.ts._App.CannotCloseWhileSaving : i18n.ts._App.CannotCloseWhileExporting,
			})
				.finally(() => { showingCloseNotice = false; });
		}
	};
	// Electron版は終了要求の時点で未保存状態を評価する。
	// 編集のたびにスナップショットを比較するためのwatchは追加しない。
	if (__ELECTRON__) window.addEventListener('beforeunload', onBeforeUnload);
	// クリック直後から保護し、保存・書き出し完了直後の終了も妨げないよう同期的に切り替える。
	const stopWatching = __ELECTRON__ ? null : watch(isCloseBlocked, blocked => {
		if (blocked) window.addEventListener('beforeunload', onBeforeUnload);
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
