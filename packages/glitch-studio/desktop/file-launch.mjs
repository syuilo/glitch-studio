import path from 'node:path';
import { getLaunchFileType } from './startup-files.mjs';

/** OSの要求を初期化前から保持し、1要求につき1つの編集ウィンドウへ渡す。 */
export class FileLaunchController {
	#started = false;
	#pendingFilePaths = [];
	#pendingEmptyLaunches = 0;

	constructor({ createWindow, activateWindow, canOpen = () => true, startupFilePaths = [] }) {
		this.createWindow = createWindow;
		this.activateWindow = activateWindow;
		this.canOpen = canOpen;
		for (const filePath of startupFilePaths) this.requestFile(filePath);
	}

	requestFile(filePath) {
		if (getLaunchFileType(filePath) == null || !path.isAbsolute(filePath)) return false;
		if (!this.canOpen()) return false;
		const normalizedPath = path.normalize(filePath);
		if (this.#started) this.createWindow(normalizedPath);
		else if (!this.#pendingFilePaths.includes(normalizedPath)) this.#pendingFilePaths.push(normalizedPath);
		return true;
	}

	requestLaunch(filePaths) {
		if (!this.canOpen()) return;
		if (filePaths.length > 0) { for (const filePath of filePaths) this.requestFile(filePath); }
		else if (this.#started) this.createWindow(null);
		else this.#pendingEmptyLaunches++;
	}

	start() {
		if (this.#started) return;
		this.#started = true;
		const filePaths = this.#pendingFilePaths;
		this.#pendingFilePaths = [];
		for (const filePath of filePaths) this.createWindow(filePath);
		const emptyLaunches = this.#pendingEmptyLaunches + (filePaths.length === 0 ? 1 : 0);
		this.#pendingEmptyLaunches = 0;
		for (let index = 0; index < emptyLaunches; index++) this.createWindow(null);
	}

	activate() {
		if (this.#started && this.canOpen() && !this.activateWindow()) this.createWindow(null);
	}
}
