import path from 'node:path';

// メインウィンドウの検証を全操作に適用し、UIへ汎用的なファイル操作を公開しない。
export function registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow, takeStartupProjectPath = () => null, directories = null) {
	ipcMain.handle('desktop:take-startup-project-file', event => {
		getTrustedMainWindow(event);
		// macOSでは全ウィンドウを閉じた後のopen-fileでも、同じプロセスに新しい要求が届く。
		// 登録時のパスを閉じ込めず、今回のウィンドウに割り当てたパスを取得する。
		const startupProjectPath = takeStartupProjectPath();
		if (startupProjectPath == null) return null;
		return projectFiles.describe(projectFiles.register(startupProjectPath));
	});
	ipcMain.handle('desktop:register-project-file', (event, filePath) => {
		getTrustedMainWindow(event);
		return projectFiles.describe(projectFiles.register(filePath));
	});
	ipcMain.handle('desktop:choose-project-file', async event => {
		const parent = getTrustedMainWindow(event);
		const projectOpenDirectory = await directories?.get('project-open');
		const result = await dialog.showOpenDialog(parent, {
			...(projectOpenDirectory == null ? {} : { defaultPath: projectOpenDirectory }),
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }], properties: ['openFile'],
		});
		if (result.canceled || result.filePaths[0] == null) return null;
		const filePath = result.filePaths[0];
		await directories?.remember('project-open', path.dirname(filePath));
		return projectFiles.describe(projectFiles.register(filePath));
	});
	ipcMain.handle('desktop:choose-project-save-file', async (event, name) => {
		const parent = getTrustedMainWindow(event);
		if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid project name');
		const projectSaveDirectory = await directories?.get('project-save');
		// Electronのダイアログはパスだけを返す。確定前の既存ファイルを変更しない。
		const result = await dialog.showSaveDialog(parent, {
			defaultPath: projectSaveDirectory == null ? name : path.join(projectSaveDirectory, name),
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }],
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
		await directories?.remember('project-save', path.dirname(filePath));
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
	ipcMain.handle('desktop:copy-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.copyProjectBackup(id, name);
	});
	ipcMain.handle('desktop:remove-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.remove(id, name);
	});
}
