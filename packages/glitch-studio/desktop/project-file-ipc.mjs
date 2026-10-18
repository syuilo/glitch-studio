import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

// メインウィンドウの検証を全操作に適用し、UIへ汎用的なファイル操作を公開しない。
export function registerProjectFileIpc(ipcMain, dialog, projectFiles, getTrustedMainWindow, startupProjectPath = null, projectOpenDirectoryFilePath = null) {
	let projectOpenDirectory = null;
	ipcMain.handle('desktop:take-startup-project-file', event => {
		getTrustedMainWindow(event);
		if (startupProjectPath == null) return null;
		const descriptor = projectFiles.describe(projectFiles.register(startupProjectPath));
		// UIが準備できてから一度だけ渡す。HMRなどで編集内容を再読込させない。
		startupProjectPath = null;
		return descriptor;
	});
	ipcMain.handle('desktop:register-project-file', (event, filePath) => {
		getTrustedMainWindow(event);
		return projectFiles.describe(projectFiles.register(filePath));
	});
	ipcMain.handle('desktop:choose-project-file', async event => {
		const parent = getTrustedMainWindow(event);
		if (projectOpenDirectoryFilePath != null) {
			try {
				// 別プロセスで最後に選んだディレクトリも、次の選択時に反映する。
				projectOpenDirectory = await fs.readFile(projectOpenDirectoryFilePath, 'utf8');
			} catch (error) {
				if (error.code !== 'ENOENT') console.error('Could not read the project open directory:', error);
			}
		}
		const result = await dialog.showOpenDialog(parent, {
			...(projectOpenDirectory == null ? {} : { defaultPath: projectOpenDirectory }),
			filters: [{ name: 'Glitch Studio project', extensions: ['gsproj'] }], properties: ['openFile'],
		});
		if (result.canceled || result.filePaths[0] == null) return null;
		const filePath = result.filePaths[0];
		const selectedDirectory = path.dirname(filePath);
		projectOpenDirectory = selectedDirectory;
		if (projectOpenDirectoryFilePath != null) {
			const temporaryFilePath = `${projectOpenDirectoryFilePath}.${randomUUID()}.tmp`;
			try {
				await fs.mkdir(path.dirname(projectOpenDirectoryFilePath), { recursive: true });
				// 他のプロセスが書きかけのパスを読まないよう、一時ファイルから置き換える。
				await fs.writeFile(temporaryFilePath, selectedDirectory, { flag: 'wx' });
				await fs.rename(temporaryFilePath, projectOpenDirectoryFilePath);
			} catch (error) {
				// 設定の保存に失敗しても、選択したプロジェクトは開けるようにする。
				console.error('Could not save the project open directory:', error);
			} finally {
				await fs.unlink(temporaryFilePath).catch(() => {});
			}
		}
		return projectFiles.describe(projectFiles.register(filePath));
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
	ipcMain.handle('desktop:copy-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.copyProjectBackup(id, name);
	});
	ipcMain.handle('desktop:remove-project-backup', (event, id, name) => {
		getTrustedMainWindow(event);
		return projectFiles.remove(id, name);
	});
}
