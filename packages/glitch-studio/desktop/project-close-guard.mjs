/** beforeunloadからの確認には同期的に返答し、元の終了要求を継続・取消できるようにする。 */
export function registerProjectCloseIpc(ipcMain, dialog, getTrustedMainWindow, getUpdateController) {
	ipcMain.on('desktop:confirm-project-close', (event, labels) => {
		let confirmed = false;
		try {
			const parent = getTrustedMainWindow(event);
			const updateController = getUpdateController();
			// 更新開始時は既に未保存データの破棄を確認済みで、インストールを妨げない。
			if (updateController?.allowQuit === true) { confirmed = true; return; }
			if (updateController?.shouldBlockQuit === true) return;
			if (labels == null || ['message', 'detail', 'closeButtonLabel', 'cancelButtonLabel'].some(key => typeof labels[key] !== 'string')) {
				throw new Error('Invalid project close confirmation labels');
			}
			confirmed = dialog.showMessageBoxSync(parent, {
				type: 'warning', title: 'Glitch Studio', message: labels.message, detail: labels.detail,
				buttons: [labels.cancelButtonLabel, labels.closeButtonLabel], defaultId: 0, cancelId: 0, noLink: true,
			}) === 1;
		} catch (error) {
			console.error('Failed to confirm project closing:', error);
		} finally {
			// returnValueへの代入は即座に返答を送るため、ダイアログ終了後に一度だけ設定する。
			// 同期IPCは例外を自動転送しないので、失敗時にも必ず取消を返す。
			event.returnValue = confirmed;
		}
	});
}
