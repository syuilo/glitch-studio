import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';

/* global console */

/** 用途の意味は呼び出し側が所有し、ここではキーごとの最終選択ディレクトリだけを記録する。 */
export class FileDialogDirectoryHistory {
	#directories = new Map();
	#unsavedKeys = new Set();
	#pendingOperation = Promise.resolve();

	constructor(directory) { this.directory = directory; }

	#entryPath(directoryKey) {
		if (typeof directoryKey !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(directoryKey)) throw new Error('Invalid file dialog directory key');
		return path.join(this.directory, `directory-${directoryKey}`);
	}

	#serializeOperation(operation) {
		const pending = this.#pendingOperation.then(operation);
		this.#pendingOperation = pending.catch(() => {});
		return pending;
	}

	get(directoryKey) {
		const filePath = this.#entryPath(directoryKey);
		return this.#serializeOperation(async () => {
			// 書き込みに失敗したときは、ディスクに残った古い値で最新の選択を巻き戻さない。
			if (!this.#unsavedKeys.has(directoryKey)) {
				try {
					this.#directories.set(directoryKey, await fs.readFile(filePath, 'utf8'));
				} catch (error) {
					if (error.code !== 'ENOENT') console.error('Could not read the file dialog directory:', error);
				}
			}
			return this.#directories.get(directoryKey) ?? null;
		});
	}

	remember(directoryKey, directory) {
		const filePath = this.#entryPath(directoryKey);
		// 読み書きの両方を直列化し、複数ウィンドウの選択や非同期の読み出しで
		// メモリ・ディスクのどちらの記録も巻き戻さない。
		return this.#serializeOperation(async () => {
			this.#directories.set(directoryKey, directory);
			this.#unsavedKeys.add(directoryKey);
			const temporaryFilePath = `${filePath}.${randomUUID()}.tmp`;
			try {
				await fs.mkdir(this.directory, { recursive: true });
				// キー単位の原子的な置換により、別インスタンスの記録や書きかけの内容を混ぜない。
				await fs.writeFile(temporaryFilePath, directory, { flag: 'wx' });
				await fs.rename(temporaryFilePath, filePath);
				this.#unsavedKeys.delete(directoryKey);
			} catch (error) {
				console.error('Could not save the file dialog directory:', error);
			} finally {
				await fs.unlink(temporaryFilePath).catch(() => {});
			}
		});
	}
}
