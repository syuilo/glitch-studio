import path from 'node:path';
import { spawn } from 'node:child_process';

/** OSから届くファイルのオープン要求と、編集ウィンドウの起動を調整する。 */
export class ProjectLaunchController {
	#started = false;
	#pendingProjectPaths = [];
	#startupProjectPath = null;

	constructor({ createWindow, hasMainWindow, openProjectInNewProcess, startupProjectPath = null }) {
		this.createWindow = createWindow;
		this.hasMainWindow = hasMainWindow;
		this.openProjectInNewProcess = openProjectInNewProcess;
		if (startupProjectPath != null) this.requestProject(startupProjectPath);
	}

	requestProject(filePath) {
		if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.gsproj') return false;
		const normalizedPath = path.normalize(filePath);
		if (this.#started) {
			this.#openProject(normalizedPath);
		} else if (!this.#pendingProjectPaths.includes(normalizedPath)) {
			// macOSのopen-fileはreadyより前にも届く。起動引数と同じファイルが届いても二重に開かない。
			this.#pendingProjectPaths.push(normalizedPath);
		}
		return true;
	}

	start() {
		if (this.#started) return;
		this.#started = true;
		const pendingProjectPaths = this.#pendingProjectPaths;
		this.#pendingProjectPaths = [];
		for (const filePath of pendingProjectPaths) this.#openProject(filePath);
		this.activate();
	}

	activate() {
		if (!this.#started || this.hasMainWindow()) return;
		this.#startupProjectPath = null;
		this.createWindow();
	}

	takeStartupProjectPath() {
		// UIが準備できた時にだけ取得する。再取得や再表示で編集内容を巻き戻さない。
		const filePath = this.#startupProjectPath;
		this.#startupProjectPath = null;
		return filePath;
	}

	#openProject(filePath) {
		if (this.hasMainWindow()) {
			// 現在のdesktop APIは1プロセスに1つの編集ウィンドウを持つ設計。
			// 編集中・読込中の作品を置き換えず、Windowsの関連付け起動と同じ単位で分離する。
			this.openProjectInNewProcess(filePath);
		} else {
			this.#startupProjectPath = filePath;
			this.createWindow();
		}
	}
}

export function launchProjectProcess(filePath, { executablePath = process.execPath, applicationPath = null, spawnProcess = spawn } = {}) {
	// .appの実行ファイルを直接起動することで、macOSの既存インスタンスへの転送を避ける。
	// 開発版のelectronにはアプリのディレクトリも必要。パスはシェルを通さず独立した引数で渡す。
	const args = applicationPath == null ? [filePath] : [applicationPath, filePath];
	return new Promise((resolve, reject) => {
		const child = spawnProcess(executablePath, args, { detached: true, stdio: 'ignore' });
		child.once('error', reject);
		child.once('spawn', () => {
			// 元の編集ウィンドウを閉じても、新しいプロセスの編集を続けられるようにする。
			child.unref();
			resolve();
		});
	});
}
