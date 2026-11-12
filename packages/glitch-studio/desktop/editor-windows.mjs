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
			handlers: new Map(), projectPath: null, projectSessions: new Map(), reservations: new Map(), closeController: null, notification: null };
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
			context.projectSessions.clear();
			context.reservations.clear();
			this.refreshProjectOwners(context);
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

	registerProject(context, filePath, saving = false, reservationId = 'startup') {
		if (context.window.isDestroyed()) throw new Error('The editor window has been closed.');
		const owner = this.findProject(filePath);
		if (owner != null && owner !== context) {
			this.focusProject(owner, filePath);
			if (saving) throw new Error('This project is open in another window. Choose a different save file.');
			return null;
		}
		if (typeof reservationId !== 'string' || reservationId.length === 0) throw new Error('Invalid project session');
		const key = this.projectKey(filePath);
		if (saving) {
			const owned = [...context.projectSessions].some(([sessionId, current]) => sessionId !== reservationId && this.projectKey(current) === key);
			const reserved = [...context.reservations].some(([sessionId, keys]) => sessionId !== reservationId && keys.has(key));
			if (owned || reserved) throw new Error('This project is open in another tab. Choose a different save file.');
		}
		const id = context.projectFiles.register(filePath);
		this.projectOwners.set(key, context);
		if (!context.reservations.has(reservationId)) context.reservations.set(reservationId, new Set());
		context.reservations.get(reservationId).add(key);
		return context.projectFiles.describe(id);
	}

	focusProject(context, filePath) {
		this.focus(context);
		const key = this.projectKey(filePath);
		for (const current of context.projectSessions.values()) {
			if (this.projectKey(current) === key) {
				context.window.webContents.send('desktop:activate-project-file', context.projectFiles.register(current));
				break;
			}
		}
	}

	setSessionProject(context, sessionId, id) {
		if (context.window.isDestroyed()) return;
		if (typeof sessionId !== 'string' || sessionId.length === 0) throw new Error('Invalid project session');
		const filePath = id == null ? null : context.projectFiles.getPath(id);
		if (filePath != null) {
			const key = this.projectKey(filePath);
			if ([...context.projectSessions].some(([other, current]) => other !== sessionId && this.projectKey(current) === key)) throw new Error('This project is already open in another tab.');
			const owner = this.findProject(filePath);
			if (owner != null && owner !== context) throw new Error('This project is open in another window.');
			context.projectSessions.set(sessionId, filePath);
			this.projectOwners.set(key, context);
		} else context.projectSessions.delete(sessionId);
		context.projectPath = filePath;
		this.releaseReservations(context, sessionId);
	}

	closeProjectSession(context, sessionId) {
		context.projectSessions.delete(sessionId);
		this.releaseReservations(context, sessionId);
		if (![...context.projectSessions.values()].includes(context.projectPath)) context.projectPath = [...context.projectSessions.values()].at(-1) ?? null;
	}

	releaseReservations(context, reservationId = 'startup') {
		context.reservations.delete(reservationId);
		this.refreshProjectOwners(context);
	}

	refreshProjectOwners(context) {
		// 保存完了・読込失敗の後処理は、その操作の予約だけを解放する。
		// 他タブの保存先と並行して選択中の保存先は、ウィンドウ間の排他対象に残す。
		const retained = new Set([...context.projectSessions.values()].map(filePath => this.projectKey(filePath)));
		for (const keys of context.reservations.values()) for (const key of keys) retained.add(key);
		for (const [key, owner] of this.projectOwners) if (owner === context && !retained.has(key)) this.projectOwners.delete(key);
	}

	broadcast(channel, ...args) {
		for (const { window } of this.contexts.values()) {
			if (window.isDestroyed()) continue;
			try { window.webContents.send(channel, ...args); }
			catch (error) { console.error('Could not notify an editor window:', error); }
		}
	}
}
