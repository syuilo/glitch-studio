import { watch } from 'vue';
import type { Ref } from 'vue';
import { i18n } from '@/i18n.ts';
import * as ui from '@/ui.ts';

/** 保存状態を終了処理へ反映し、Appの破棄時に解除できるようにする。 */
export function installProjectSaveCloseGuard(isProjectSaving: Readonly<Ref<boolean>>): () => void {
	let showingCloseNotice = false;
	const onBeforeUnload = (event: BeforeUnloadEvent) => {
		if (!isProjectSaving.value) return;
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
	// クリック直後から保護し、保存完了直後の終了も妨げないよう同期的に切り替える。
	const stopWatching = watch(isProjectSaving, saving => {
		if (saving) window.addEventListener('beforeunload', onBeforeUnload);
		else window.removeEventListener('beforeunload', onBeforeUnload);
	}, { immediate: true, flush: 'sync' });
	return () => {
		stopWatching();
		window.removeEventListener('beforeunload', onBeforeUnload);
	};
}
