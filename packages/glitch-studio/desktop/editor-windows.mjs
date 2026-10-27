import path from 'node:path';
import { ProjectFiles } from './project-files.mjs';
import { ExportFiles } from './export-files.mjs';
import { ExternalAssetFiles } from './external-assets.mjs';

/** 編集ウィンドウの寿命とIPCの宛先、編集中・読込中の保存先の所有権を管理する。 */
export class EditorWindows {
	constructor({ ipcMain, isAppUrl }) {
		this.ipcMain = ipcMain;
		this.isAppUrl = isAppUrl;
		this.contexts = new Map();
		this.channels = new Set();
		this.projectOwners = new Map();
		this.lastFocused = null;
	}

	add(window, startupFilePath = null) {
		const context = { window, startupFilePath, projectFiles: new ProjectFiles(), exportFiles: new ExportFiles(), externalAssetFiles: new ExternalAssetFiles(),
			handlers: new Map(), projectPath: null, reservations: new Set(), closeController: null, notification: null };
		this.contexts.set(window.webContents.id, context);
		context.ipc = { handle: (channel, handler) => {
			context.handlers.set(channel, handler);
			if (this.channels.has(channel)) return;
			this.channels.add(channel);
			this.ipcMain.handle(channel, (event, ...args) => {
				const senderContext = this.trusted(event);
				const senderHandler = senderContext.handlers.get(channel);
				if (senderHandler == null) throw new Error('The editor window is not ready.');
				return senderHandler(event, ...args);
			});
		} };
		window.on('focus', () => { this.lastFocused = context; });
		const webContentsId = window.webContents.id;
		window.once('closed', () => {
			this.contexts.delete(webContentsId);
			this.releaseReservations(context, null);
			context.projectFiles.clear();
			context.exportFiles.clear();
			context.externalAssetFiles.clear();
			context.handlers.clear();
			if (this.lastFocused === context) this.lastFocused = null;
		});
		return context;
	}

	trusted(event) {
		const context = this.contexts.get(event.sender?.id);
		if (context == null || event.sender !== context.window.webContents ||
			event.senderFrame !== event.sender.mainFrame || !this.isAppUrl(event.senderFrame.url)) throw new Error('Untrusted desktop request');
		return context;
	}

	focus(context) {
		const window = context.window;
		if (window.isDestroyed()) return;
		if (window.isMinimized()) window.restore();
		if (!window.isVisible()) { window.once('show', () => { window.focus(); }); return; }
		window.focus();
	}

	activate() {
		const context = this.lastFocused ?? [...this.contexts.values()].at(-1);
		if (context == null) return false;
		this.focus(context);
		return true;
	}

	projectKey(filePath) {
		const normalized = path.resolve(filePath);
		return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
	}

	findProject(filePath) { return this.projectOwners.get(this.projectKey(filePath)) ?? null; }

	registerProject(context, filePath, saving = false) {
		if (context.window.isDestroyed()) throw new Error('The editor window has been closed.');
		const owner = this.findProject(filePath);
		if (owner != null && owner !== context) {
			this.focus(owner);
			if (saving) throw new Error('This project is open in another window. Choose a different save file.');
			return null;
		}
		const id = context.projectFiles.register(filePath);
		const key = this.projectKey(filePath);
		this.projectOwners.set(key, context);
		context.reservations.add(key);
		return context.projectFiles.describe(id);
	}

	setCurrentProject(context, id) {
		if (context.window.isDestroyed()) return;
		const filePath = id == null ? null : context.projectFiles.getPath(id);
		if (filePath != null) this.registerProject(context, filePath, true);
		context.projectPath = filePath;
		this.releaseReservations(context);
	}

	releaseReservations(context, retainedPath = context.projectPath) {
		const retainedKey = retainedPath == null ? null : this.projectKey(retainedPath);
		for (const key of context.reservations) {
			if (key !== retainedKey && this.projectOwners.get(key) === context) {
				this.projectOwners.delete(key);
				context.reservations.delete(key);
			}
		}
	}

	broadcast(channel, ...args) {
		for (const { window } of this.contexts.values()) {
			if (window.isDestroyed()) continue;
			try { window.webContents.send(channel, ...args); }
			catch (error) { console.error('Could not notify an editor window:', error); }
		}
	}
}
