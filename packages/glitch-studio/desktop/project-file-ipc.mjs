import path from 'node:path';

// メインウィンドウの検証を全操作に適用し、UIへ汎用的なファイル操作を公開しない。
export function registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow) {
	ipcMain.handle('desktop:register-project-file', (event, filePath) => {
		getTrustedMainWindow(event);
		return projectFiles.describe(projectFiles.register(filePath));
	});
	ipcMain.handle('desktop:choose-project-file', async event => {
		const parent = getTrustedMainWindow(event);
		const result = await dialog.showOpenDialog(parent, {
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }], properties: ['openFile'],
		});
		return result.canceled || !result.filePaths[0] ? null : projectFiles.describe(projectFiles.register(result.filePaths[0]));
	});
	ipcMain.handle('desktop:choose-project-save-file', async (event, name) => {
		const parent = getTrustedMainWindow(event);
		if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid project name');
		// Electronのダイアログはパスだけを返す。確定前の既存ファイルを変更しない。
		const result = await dialog.showSaveDialog(parent, {
			defaultPath: name, filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }],
			properties: ['showOverwriteConfirmation'],
		});
		if (result.canceled || !result.filePath) return null;
		const filePath = result.filePath.toLowerCase().endsWith('.gsproj') ? result.filePath : `${result.filePath}.gsproj`;
		// 拡張子を補った場合、OSが確認したパスとは異なるのでここで上書き確認する。
		const id = projectFiles.register(filePath);
		if (filePath !== result.filePath && await projectFiles.exists(id)) {
			const confirmation = await dialog.showMessageBox(parent, { type: 'question', message: `Replace ${path.basename(filePath)}?`, buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0 });
			if (confirmation.response !== 1) return null;
		}
		return projectFiles.describe(id);
	});
	ipcMain.handle('desktop:read-project-file', (event, id) => {
		getTrustedMainWindow(event);
		return projectFiles.read(id);
	});
	ipcMain.handle('desktop:write-project-file', (event, id, data) => {
		getTrustedMainWindow(event);
		return projectFiles.write(id, data);
	});
	ipcMain.handle('desktop:list-project-backups', (event, id) => {
		getTrustedMainWindow(event);
		return projectFiles.list(id);
	});
	ipcMain.handle('desktop:write-project-backup', (event, id, name, data) => {
		getTrustedMainWindow(event);
		return projectFiles.create(id, name, data);
	});
	ipcMain.handle('desktop:remove-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.remove(id, name);
	});
}
