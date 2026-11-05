/** 送信元を検証し、クリップボードのテキスト操作だけを公開する。 */
export function registerClipboardIpc(ipcMain, clipboard, getTrustedMainWindow) {
	ipcMain.handle('desktop:read-clipboard-text', async event => {
		getTrustedMainWindow(event);
		return clipboard.readText();
	});
	ipcMain.handle('desktop:write-clipboard-text', async (event, text) => {
		getTrustedMainWindow(event);
		if (typeof text !== 'string') throw new Error('Clipboard text must be a string');
		await clipboard.writeText(text);
	});
}
