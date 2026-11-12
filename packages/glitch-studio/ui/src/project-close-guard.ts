import { computed } from 'vue';
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
		if (!isCloseBlocked.value && (confirmed || !hasUnsavedChanges.value)) return;
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
	// Web版も終了要求の時点で全セッションの最新状態を評価する。
	// 同期watchで編集中のスナップショット比較を増やさず、編集・保存・Undo直後の
	// 終了にも間に合わせる。保存済みならリスナーがあっても確認は要求しない。
	window.addEventListener('beforeunload', onBeforeUnload);
	return () => {
		disposed = true;
		stopListening?.();
		if (activeRequestId != null) void desktop?.completeProjectClose(activeRequestId, false).catch(console.error);
		window.removeEventListener('beforeunload', onBeforeUnload);
	};
}
