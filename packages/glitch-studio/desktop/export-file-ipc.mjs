import path from 'node:path';
import * as fs from 'node:fs/promises';

export function registerExportFileIpc(ipcMain, dialog, exportFiles, getTrustedMainWindow) {
	ipcMain.handle('desktop:choose-export-save-file', async (event, name, format) => {
		const parent = getTrustedMainWindow(event);
		if (typeof name !== 'string' || name.length === 0 || !['mp4', 'webp'].includes(format)) {
			throw new Error('Invalid export save settings');
		}
		// Sceneやプロジェクトの名前はファイル名として使えない文字を含むことがある。
		const suggestedName = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
		const result = await dialog.showSaveDialog(parent, {
			defaultPath: suggestedName,
			filters: [{ name: format === 'mp4' ? 'MP4 video' : 'WebP image', extensions: [format] }],
			properties: ['showOverwriteConfirmation'],
		});
		if (result.canceled || result.filePath == null) return null;
		const filePath = result.filePath.toLowerCase().endsWith(`.${format}`) ? result.filePath : `${result.filePath}.${format}`;
		// 拡張子補完でOSが確認したパスと変わる場合は、実際の保存先を改めて確認する。
		if (filePath !== result.filePath) {
			let exists = false;
			try { await fs.stat(filePath); exists = true; } catch (error) {
				if (error.code !== 'ENOENT') throw error;
			}
			if (exists) {
				const confirmation = await dialog.showMessageBox(parent, {
					type: 'question', message: `Replace ${path.basename(filePath)}?`,
					buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0,
				});
				if (confirmation.response !== 1) return null;
			}
		}
		return exportFiles.register(filePath);
	});
	ipcMain.handle('desktop:write-export-file', (event, id, data) => {
		getTrustedMainWindow(event);
		return exportFiles.write(id, data);
	});
	ipcMain.handle('desktop:release-export-file', (event, id) => {
		getTrustedMainWindow(event);
		exportFiles.release(id);
	});
}
