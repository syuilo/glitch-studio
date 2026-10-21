/** 入力欄の編集はChromiumへ委ね、エディタ固有の操作は発生したDOMイベントで処理する。 */
export function registerEditCommandIpc(ipcMain, getTrustedMainWindow) {
	ipcMain.handle('desktop:execute-edit-command', (event, command) => {
		const contents = getTrustedMainWindow(event).webContents;
		switch (command) {
			case 'copy': contents.copy(); break;
			case 'paste': contents.paste(); break;
			case 'cut': contents.cut(); break;
			case 'delete': contents.delete(); break;
			default: throw new Error('Unsupported edit command');
		}
	});
}
