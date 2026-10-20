import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

/** ダイアログの用途ごとに開始場所を記憶し、OSが共有する直近のディレクトリに依存しない。 */
export class FileDialogDirectories {
	constructor(directory, defaultDirectory) {
		this.directory = directory;
		this.defaultDirectory = defaultDirectory;
		this.rememberedDirectories = new Map();
	}

	async get(purpose) {
		try {
			// 選択のたびに読み、別プロセスで選んだ最新の場所も反映する。
			const directory = await fs.readFile(path.join(this.directory, `${purpose}-directory`), 'utf8');
			this.rememberedDirectories.set(purpose, directory);
		} catch (error) {
			if (error.code !== 'ENOENT') console.error('Could not read the file dialog directory:', error);
		}
		return this.rememberedDirectories.get(purpose) ?? this.defaultDirectory;
	}

	async remember(purpose, directory) {
		this.rememberedDirectories.set(purpose, directory);
		const destination = path.join(this.directory, `${purpose}-directory`);
		const temporary = `${destination}.${randomUUID()}.tmp`;
		try {
			await fs.mkdir(this.directory, { recursive: true });
			// 別プロセスが書きかけのパスを読まないよう、一時ファイルから置き換える。
			await fs.writeFile(temporary, directory, { flag: 'wx' });
			await fs.rename(temporary, destination);
		} catch (error) {
			// 設定の保存に失敗しても、ファイル選択・読み込み・保存は続けられるようにする。
			console.error('Could not save the file dialog directory:', error);
		} finally {
			await fs.unlink(temporary).catch(() => {});
		}
	}
}
