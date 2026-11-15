import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';

async function isDirectory(directory) {
	if (directory == null || !path.isAbsolute(directory)) return false;
	try { return (await fs.stat(directory)).isDirectory(); } catch { return false; }
}

/** OSの共通履歴に依存せず、同じ用途キーのダイアログだけで開始位置を共有する。 */
export class FileDialogs {
	constructor(dialog, directoryHistory, defaultDirectory) {
		this.dialog = dialog;
		this.directoryHistory = directoryHistory;
		this.defaultDirectory = defaultDirectory;
	}

	async #startingDirectory(directoryKey, initialDirectory) {
		if (await isDirectory(initialDirectory)) return initialDirectory;
		const rememberedDirectory = await this.directoryHistory.get(directoryKey);
		if (await isDirectory(rememberedDirectory)) return rememberedDirectory;
		// 未使用の用途にも絶対パスを渡し、直前に開いた別用途のダイアログに引きずられない。
		return await isDirectory(this.defaultDirectory) ? this.defaultDirectory : os.homedir();
	}

	async showOpenDialog(parent, { directoryKey, initialDirectory = null, ...options }) {
		const defaultPath = await this.#startingDirectory(directoryKey, initialDirectory);
		const result = await this.dialog.showOpenDialog(parent, { ...options, defaultPath });
		const selectedPath = result.filePaths[0];
		if (!result.canceled && selectedPath != null) {
			const selectedDirectory = options.properties?.includes('openDirectory') === true && await isDirectory(selectedPath)
				? selectedPath : path.dirname(selectedPath);
			await this.directoryHistory.remember(directoryKey, selectedDirectory);
		}
		return result;
	}

	async showSaveDialog(parent, { directoryKey, initialDirectory = null, suggestedName, ...options }) {
		if (typeof suggestedName !== 'string' || path.basename(suggestedName) !== suggestedName) throw new Error('Invalid suggested file name');
		const directory = await this.#startingDirectory(directoryKey, initialDirectory);
		const result = await this.dialog.showSaveDialog(parent, { ...options, defaultPath: path.join(directory, suggestedName) });
		// 記録するのはダイアログで確定した場所。以後の読込・保存の成否とは独立させる。
		if (!result.canceled && result.filePath != null) await this.directoryHistory.remember(directoryKey, path.dirname(result.filePath));
		return result;
	}
}
