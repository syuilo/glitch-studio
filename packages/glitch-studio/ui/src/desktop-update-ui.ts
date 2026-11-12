import { projectSessions } from './app.ts';
import { DesktopUpdateUiController } from './DesktopUpdateUiController.ts';
import { DesktopUpdates } from './desktop-updates.ts';

// プロジェクトや画面ごとに生成せず、すべての更新通知から同じ状態・確認フローを利用する。
export const desktopUpdateUi = __ELECTRON__ && window.desktop != null
	? new DesktopUpdateUiController(new DesktopUpdates(window.desktop, () => projectSessions.reserveForDesktopUpdate())) : null;
