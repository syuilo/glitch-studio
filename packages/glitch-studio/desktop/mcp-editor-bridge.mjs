import { randomUUID } from 'node:crypto';
import { setTimeout, clearTimeout } from 'node:timers';

const editorOperations = new Set(['search_scripting_api', 'get_scripting_api', 'execute_script', 'capture_preview', 'seek_timeline_and_capture']);

function failure(code, message) {
	return Object.assign(new Error(`${code}: ${message}`), { code });
}

/** HTTPの接続とは独立して、編集ウィンドウの寿命と要求・応答の対応を管理する。 */
export class McpEditorBridge {
	constructor({ timeoutMs = 65_000 } = {}) {
		this.timeoutMs = timeoutMs;
		this.windows = new Map();
		this.pending = new Map();
		this.disposed = false;
	}

	addWindow(context) {
		const webContents = context.window.webContents;
		const webContentsId = webContents.id;
		const entry = { context, ready: false, sessions: [] };
		this.windows.set(webContentsId, entry);
		const invalidate = () => {
			entry.ready = false;
			entry.sessions = [];
			for (const pending of [...this.pending.values()]) {
				if (pending.entry === entry) pending.cancel(failure('EDITOR_CLOSED', 'The editor was closed or reloaded.'));
			}
		};
		webContents.on('did-start-loading', invalidate);
		webContents.on('render-process-gone', invalidate);
		context.window.once('closed', () => {
			invalidate();
			this.windows.delete(webContentsId);
			webContents.removeListener('did-start-loading', invalidate);
			webContents.removeListener('render-process-gone', invalidate);
		});
	}

	updateSessions(context, summaries) {
		const entry = this.windows.get(context.window.webContents.id);
		if (this.disposed || entry == null || entry.context !== context) return;
		if (!Array.isArray(summaries) || summaries.length > 1000) throw new Error('Invalid MCP project sessions');
		const identifiers = new Set();
		const sessions = summaries.map(summary => {
			if (summary == null || typeof summary.projectSessionId !== 'string' || summary.projectSessionId.length === 0 || summary.projectSessionId.length > 256
				|| typeof summary.name !== 'string' || typeof summary.isActive !== 'boolean' || typeof summary.isScriptRunning !== 'boolean'
				|| (summary.activeSceneId != null && (typeof summary.activeSceneId !== 'string' || summary.activeSceneId.length === 0 || summary.activeSceneId.length > 256))
				|| identifiers.has(summary.projectSessionId)) throw new Error('Invalid MCP project session');
			identifiers.add(summary.projectSessionId);
			for (const other of this.windows.values()) {
				if (other !== entry && other.sessions.some(session => session.projectSessionId === summary.projectSessionId)) throw new Error('Duplicate MCP project session');
			}
			return { projectSessionId: summary.projectSessionId, name: summary.name.slice(0, 1000), isActive: summary.isActive, isScriptRunning: summary.isScriptRunning, activeSceneId: summary.activeSceneId ?? null };
		});
		entry.sessions = sessions;
		entry.ready = true;
		for (const pending of [...this.pending.values()]) {
			if (pending.entry === entry && pending.projectSessionId != null && !identifiers.has(pending.projectSessionId)) {
				pending.cancel(failure('PROJECT_CLOSED', 'The project session has been closed.'));
			}
		}
	}

	async invoke(operation, input, signal) {
		if (this.disposed) throw failure('SERVER_STOPPED', 'The MCP server is stopping.');
		signal?.throwIfAborted();
		if (operation === 'list_project_sessions') {
			return [...this.windows.entries()].flatMap(([windowId, entry]) => entry.sessions.map(session => ({ ...session, windowId: String(windowId) })));
		}
		if (!editorOperations.has(operation)) throw failure('UNKNOWN_OPERATION', 'Unknown editor operation.');
		if (input == null || typeof input !== 'object' || Array.isArray(input)) throw failure('INVALID_INPUT', 'Expected an input object.');
		const needsProject = operation === 'execute_script' || operation === 'capture_preview' || operation === 'seek_timeline_and_capture';
		const projectSessionId = needsProject ? input.projectSessionId : null;
		if (needsProject && (typeof projectSessionId !== 'string' || projectSessionId.length === 0)) throw failure('INVALID_INPUT', 'projectSessionId is required.');
		const entry = [...this.windows.values()].find(candidate => candidate.ready && !candidate.context.window.isDestroyed()
			&& (!needsProject || candidate.sessions.some(session => session.projectSessionId === projectSessionId)));
		if (entry == null) throw failure(needsProject ? 'PROJECT_NOT_FOUND' : 'EDITOR_UNAVAILABLE', needsProject ? 'The project session is no longer open.' : 'Open an editor window and try again.');
		if (this.pending.size >= 16) throw failure('SERVER_BUSY', 'Too many pending editor requests.');
		const requestId = randomUUID();
		return new Promise((resolve, reject) => {
			let timer = null;
			const finish = (error, result) => {
				if (!this.pending.delete(requestId)) return;
				clearTimeout(timer);
				signal?.removeEventListener('abort', onAbort);
				if (error != null) reject(error);
				else resolve(result);
			};
			const cancel = error => {
				// UIへ中断を伝えてから受付を解放する。遅れた応答はrequestIdの照合で捨てる。
				try { entry.context.window.webContents.send('desktop:mcp-cancel', requestId); } catch { /* 画面破棄済み */ }
				finish(error);
			};
			const onAbort = () => cancel(failure('CANCELLED', 'The request was cancelled. Completed edits may remain.'));
			this.pending.set(requestId, { entry, projectSessionId, finish, cancel });
			timer = setTimeout(() => cancel(failure('TIMEOUT', 'The editor did not finish in time. Completed edits may remain; inspect the project before retrying.')), this.timeoutMs);
			signal?.addEventListener('abort', onAbort, { once: true });
			try { entry.context.window.webContents.send('desktop:mcp-request', { requestId, operation, input }); } catch (error) { finish(error); }
		});
	}

	respond(context, response) {
		if (response == null || typeof response.requestId !== 'string') throw new Error('Invalid MCP response');
		const pending = this.pending.get(response.requestId);
		if (pending == null) return;
		if (pending.entry.context !== context) throw new Error('MCP response belongs to another editor window');
		if (response.ok === true) pending.finish(null, response.result);
		else if (response.ok === false && typeof response.error?.code === 'string' && typeof response.error?.message === 'string') {
			pending.finish(failure(response.error.code.slice(0, 100), response.error.message.slice(0, 10_000)));
		} else throw new Error('Invalid MCP response');
	}

	dispose() {
		this.disposed = true;
		for (const pending of [...this.pending.values()]) pending.cancel(failure('SERVER_STOPPED', 'The MCP server has stopped.'));
		this.windows.clear();
	}
}

/** 切り離したパネルや他サイトから、認証情報の取得・要求の偽装を行わせない。 */
export function registerMcpIpc(ipcMain, { controller, bridge, editorWindows }) {
	const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => action(editorWindows.trusted(event), ...args));
	handle('desktop:get-mcp-server-state', () => controller.getState());
	handle('desktop:set-mcp-server-settings', (_context, settings) => controller.setSettings(settings));
	handle('desktop:regenerate-mcp-server-token', () => controller.regenerateToken());
	handle('desktop:mcp-project-sessions', (context, sessions) => bridge.updateSessions(context, sessions));
	handle('desktop:mcp-response', (context, response) => bridge.respond(context, response));
}
