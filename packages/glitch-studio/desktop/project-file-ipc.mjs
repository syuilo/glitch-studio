import path from 'node:path';

// メインウィンドウの検証を全操作に適用し、UIへ汎用的なファイル操作を公開しない。
export function registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow, fileDialogs, {
	registerProject,
	projectWillWrite,
	projectWritten,
}) {
	ipcMain.handle('desktop:register-project-file', (event, filePath, reservationId) => {
		getTrustedMainWindow(event);
		return registerProject(filePath, false, reservationId);
	});
	ipcMain.handle('desktop:choose-project-file', async (event, reservationId) => {
		const parent = getTrustedMainWindow(event);
		const result = await fileDialogs.showOpenDialog(parent, {
			directoryKey: 'project-open',
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }], properties: ['openFile'],
		});
		if (result.canceled || result.filePaths[0] == null) return null;
		const filePath = result.filePaths[0];
		return registerProject(filePath, false, reservationId);
	});
	ipcMain.handle('desktop:choose-project-save-file', async (event, name, sessionId) => {
		const parent = getTrustedMainWindow(event);
		if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Invalid project session');
		if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid project name');
		// Electronのダイアログはパスだけを返す。確定前の既存ファイルを変更しない。
		const result = await fileDialogs.showSaveDialog(parent, {
			directoryKey: 'project-save', suggestedName: name,
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }],
			properties: ['showOverwriteConfirmation'],
		});
		if (result.canceled || result.filePath == null) return null;
		const filePath = result.filePath.toLowerCase().endsWith('.gsproj') ? result.filePath : `${result.filePath}.gsproj`;
		// 拡張子を補った場合、OSが確認したパスとは異なるのでここで上書き確認する。
		const descriptor = registerProject(filePath, true, sessionId);
		const id = descriptor.id;
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
	ipcMain.handle('desktop:write-project-file', async (event, id, data, sessionId) => {
		getTrustedMainWindow(event);
		if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Invalid project session');
		projectWillWrite(id, sessionId);
		await projectFiles.write(id, data);
		projectWritten(id, sessionId);
	});
	ipcMain.handle('desktop:list-project-backups', (event, id) => {
		getTrustedMainWindow(event);
		return projectFiles.list(id);
	});
	ipcMain.handle('desktop:write-project-backup', (event, id, name, data) => {
		getTrustedMainWindow(event);
		return projectFiles.create(id, name, data);
	});
	ipcMain.handle('desktop:copy-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.copyProjectBackup(id, name);
	});
	ipcMain.handle('desktop:remove-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.remove(id, name);
	});
}
