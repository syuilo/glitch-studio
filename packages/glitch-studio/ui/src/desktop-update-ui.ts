import { appContext } from './app.ts';
import { applicationActivity } from './application-activity.ts';
import { DesktopUpdateUiController } from './DesktopUpdateUiController.ts';
import { DesktopUpdates } from './desktop-updates.ts';
import { i18n } from './i18n.ts';

// プロジェクトや画面ごとに生成せず、すべての更新通知から同じ状態・確認フローを利用する。
export const desktopUpdateUi = __ELECTRON__ && window.desktop != null ? new DesktopUpdateUiController(new DesktopUpdates(window.desktop, {
	reserve() {
		const release = applicationActivity.beginUpdate();
		if (release == null) throw new Error(i18n.ts._DesktopUpdate.ApplicationBusy);
		return release;
	},
	async pause() {
		return appContext.pauseForDesktopUpdate();
	},
})) : null;
