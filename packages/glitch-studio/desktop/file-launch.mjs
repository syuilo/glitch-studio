import path from 'node:path';
import { spawn } from 'node:child_process';
import { getLaunchFileType } from './startup-files.mjs';

/** OSから届くファイルのオープン要求と、編集ウィンドウの起動を調整する。 */
export class FileLaunchController {
	#started = false;
	#pendingFilePaths = [];
	#startupFilePath = null;

	constructor({ createWindow, hasMainWindow, openFileInNewProcess, startupFilePaths = [] }) {
		this.createWindow = createWindow;
		this.hasMainWindow = hasMainWindow;
		this.openFileInNewProcess = openFileInNewProcess;
		for (const filePath of startupFilePaths) this.requestFile(filePath);
	}

	requestFile(filePath) {
		if (getLaunchFileType(filePath) == null || !path.isAbsolute(filePath)) return false;
		const normalizedPath = path.normalize(filePath);
		if (this.#started) {
			this.#openFile(normalizedPath);
		} else if (!this.#pendingFilePaths.includes(normalizedPath)) {
			// macOSのopen-fileはreadyより前にも届く。起動引数と同じファイルが届いても二重に開かない。
			this.#pendingFilePaths.push(normalizedPath);
		}
		return true;
	}

	start() {
		if (this.#started) return;
		this.#started = true;
		const pendingFilePaths = this.#pendingFilePaths;
		this.#pendingFilePaths = [];
		for (const filePath of pendingFilePaths) this.#openFile(filePath);
		this.activate();
	}

	activate() {
		if (!this.#started || this.hasMainWindow()) return;
		this.#startupFilePath = null;
		this.createWindow();
	}

	takeStartupFilePath() {
		// UIが準備できた時にだけ取得する。再取得や再表示で編集内容を巻き戻さない。
		const filePath = this.#startupFilePath;
		this.#startupFilePath = null;
		return filePath;
	}

	#openFile(filePath) {
		if (this.hasMainWindow()) {
			// 現在のdesktop APIは1プロセスに1つの編集ウィンドウを持つ設計。
			// 編集中・読込中の作品を置き換えず、Windowsの関連付け起動と同じ単位で分離する。
			this.openFileInNewProcess(filePath);
		} else {
			this.#startupFilePath = filePath;
			this.createWindow();
		}
	}
}

export function launchFileProcess(filePath, { executablePath = process.execPath, applicationPath = null, spawnProcess = spawn } = {}) {
	// .appの実行ファイルを直接起動することで、macOSの既存インスタンスへの転送を避ける。
	// 開発版のelectronにはアプリのディレクトリも必要。パスはシェルを通さず独立した引数で渡す。
	const args = applicationPath == null ? [filePath] : [applicationPath, filePath];
	return new Promise((resolve, reject) => {
		const child = spawnProcess(executablePath, args, { detached: true, stdio: 'ignore', windowsHide: true });
		child.once('error', reject);
		child.once('spawn', () => {
			// 元の編集ウィンドウを閉じても、新しいプロセスの編集を続けられるようにする。
			child.unref();
			resolve();
		});
	});
}
