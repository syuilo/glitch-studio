/** Vueでの非同期確認が終わるまで、取り消された終了・再読み込み要求を保持する。 */
export class ProjectCloseController {
	constructor({ app, window, getUpdateController }) {
		const webContents = window.webContents;
		this.app = app;
		this.window = window;
		this.getUpdateController = getUpdateController;
		this.requestedAction = null;
		this.pendingConfirmation = null;
		this.nextRequestId = 0;
		this.onBeforeQuit = () => {
			if (getUpdateController()?.shouldBlockQuit !== true) this.requestedAction = 'quit';
		};
		this.onClose = () => {
			if (getUpdateController()?.shouldBlockQuit !== true && this.requestedAction !== 'quit') this.requestedAction = 'close';
		};
		this.onWillPreventUnload = event => {
			// 自動更新は開始前に破棄を確認済みなので、Vueの確認を重ねず終了する。
			if (getUpdateController()?.allowQuit === true) { event.preventDefault(); return; }
			const action = this.requestedAction ?? 'reload';
			this.requestedAction = null;
			if (this.pendingConfirmation != null) {
				// 確認中のCmd+Qなどは、ウィンドウを閉じるだけの操作に縮めない。
				if (action === 'quit') this.pendingConfirmation.action = 'quit';
				return;
			}
			const request = { requestId: ++this.nextRequestId, action };
			this.pendingConfirmation = request;
			// イベント内では終了取消がまだ処理中なので、取消後の確認として扱えるよう
			// UIへの通知を次のイベントループへ送り、そこで描画とユーザーの返答を待つ。
			setImmediate(() => {
				if (this.pendingConfirmation === request && !window.isDestroyed()) window.webContents.send('desktop:project-close-requested', request.requestId);
			});
		};
		this.reset = () => { this.requestedAction = null; this.pendingConfirmation = null; };
		this.dispose = () => {
			this.reset();
			app.removeListener('before-quit', this.onBeforeQuit);
			window.removeListener('close', this.onClose);
			// closedではBrowserWindow.webContentsを取得できないため、生成時の参照で解除する。
			webContents.removeListener('will-prevent-unload', this.onWillPreventUnload);
			webContents.removeListener('did-start-loading', this.reset);
			webContents.removeListener('render-process-gone', this.reset);
		};
		app.on('before-quit', this.onBeforeQuit);
		window.on('close', this.onClose);
		window.webContents.on('will-prevent-unload', this.onWillPreventUnload);
		window.webContents.on('did-start-loading', this.reset);
		window.webContents.on('render-process-gone', this.reset);
		window.once('closed', this.dispose);
	}

	complete(requestId, confirmed) {
		const request = this.pendingConfirmation;
		if (request == null || request.requestId !== requestId) return false;
		this.pendingConfirmation = null;
		if (!confirmed || this.window.isDestroyed() || this.getUpdateController()?.shouldBlockQuit === true) return false;
		if (request.action === 'quit') this.app.quit();
		else if (request.action === 'close') this.window.close();
		else this.window.webContents.reload();
		return true;
	}
}

export function registerProjectCloseIpc(ipcMain, getTrustedMainWindow, getProjectCloseController) {
	ipcMain.handle('desktop:complete-project-close', (event, requestId, confirmed) => {
		const window = getTrustedMainWindow(event);
		if (!Number.isSafeInteger(requestId) || typeof confirmed !== 'boolean') throw new Error('Invalid project close response');
		const controller = getProjectCloseController();
		return controller?.window === window ? controller.complete(requestId, confirmed) : false;
	});
}
