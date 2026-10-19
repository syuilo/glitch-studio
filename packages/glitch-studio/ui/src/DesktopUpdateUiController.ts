import { computed, watch } from 'vue';
import GsDesktopUpdateDialog from './components/GsDesktopUpdateDialog.vue';
import { i18n } from './i18n.ts';
import * as ui from './ui.ts';
import type { DesktopUpdates } from './desktop-updates.ts';
import type { ComputedRef } from 'vue';

/** アプリ全体で更新の確認・進捗・再試行のUIを共有する。 */
export class DesktopUpdateUiController {
	readonly state: DesktopUpdates['state'];
	readonly working: ComputedRef<boolean>;
	private initialization: Promise<void> | null = null;
	private confirmingUpdate = false;
	private disposeUpdateDialog: (() => void) | null = null;

	constructor(private readonly updates: DesktopUpdates) {
		this.state = updates.state;
		this.working = computed(() => updates.running.value || ['preparing', 'downloading', 'installing'].includes(updates.state.value.phase));
	}

	initialize(): Promise<void> {
		if (this.initialization == null) {
			// main.tsから一度だけ開始し、IPC購読と表示の監視はアプリの実行中を通して保持する。
			// 画面のマウント・アンマウントでは更新状態や進行中のダイアログを破棄しない。
			watch(this.working, working => { if (working) this.showUpdateDialog(); }, { immediate: true });
			this.initialization = this.updates.connect();
		}
		return this.initialization;
	}

	private showUpdateDialog(): void {
		if (this.disposeUpdateDialog != null) return;
		const { dispose } = ui.popup(GsDesktopUpdateDialog, { state: this.state, working: this.working, localError: this.updates.localError }, {
			closed: () => { dispose(); this.disposeUpdateDialog = null; },
			retry: () => { void this.requestUpdate(); },
		});
		this.disposeUpdateDialog = dispose;
	}

	async requestUpdate(): Promise<void> {
		const version = this.state.value.version;
		if (version == null || this.updates.running.value || this.confirmingUpdate) return;
		if (this.state.value.phase === 'restart-required') { this.showUpdateDialog(); return; }
		this.confirmingUpdate = true;
		this.disposeUpdateDialog?.();
		this.disposeUpdateDialog = null;
		try {
			const { canceled } = await ui.confirm({
				type: 'warning',
				title: i18n.tsx._DesktopUpdate.ConfirmTitle({ version }),
				text: i18n.ts._DesktopUpdate.ConfirmText,
				okText: i18n.ts._DesktopUpdate.UpdateAndRestart,
				autofocus: 'cancel',
			});
			if (canceled) return;
			this.showUpdateDialog();
			void this.updates.start(version);
		} finally { this.confirmingUpdate = false; }
	}

	async checkForUpdates(): Promise<void> {
		try {
			const state = await this.updates.check();
			if (state.phase === 'not-available') await ui.alert({ type: 'info', text: i18n.ts._DesktopUpdate.UpToDate });
			else if (state.phase === 'restart-required') this.showUpdateDialog();
			else if (state.phase === 'error') await ui.alert({ type: 'error', text: `${i18n.ts._DesktopUpdate.CheckFailed}\n${state.error?.message ?? ''}` });
		} catch (error) { await ui.alert({ type: 'error', text: String(error) }); }
	}
}
