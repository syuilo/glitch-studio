import { getLaunchFileType } from './startup-files.mjs';

export function registerStartupFileIpc(ipcMain, projectFiles, getTrustedMainWindow, takeStartupFilePath) {
	ipcMain.handle('desktop:take-startup-file', event => {
		getTrustedMainWindow(event);
		// macOSの全ウィンドウを閉じた後の要求にも、同じハンドラーで応答する。
		// UIの準備前には送信せず、現在のウィンドウ向けの要求を一度だけ渡す。
		const filePath = takeStartupFilePath();
		const fileType = getLaunchFileType(filePath);
		if (fileType == null) return null;
		return fileType.kind === 'project'
			? { kind: 'project', file: projectFiles.describe(projectFiles.register(filePath)) }
			: { kind: 'media', path: filePath, type: fileType.type };
	});
}
