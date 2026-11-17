import { watch } from 'vue';
import { getProjectScriptApiReference, searchProjectScriptApi } from '../scripting/project-script-api-reference.ts';
import { captureProjectPreview, seekTimelineAndCapture } from './capture-preview.ts';
import type { McpEditorRequest, McpEditorResponse } from '@gs/glitch-studio_shared/mcp.ts';
import type { ProjectSessionManager } from '../ProjectSessionManager.ts';

type DesktopMcpEditorApi = Pick<NonNullable<Window['desktop']>, 'onMcpRequest' | 'onMcpCancel' | 'respondMcpRequest' | 'updateMcpProjectSessions'>;

/** 一つの編集ウィンドウに届く要求だけを扱い、MCPや認証の実装はmainに任せる。 */
export function connectMcpEditor(projectSessions: Pick<ProjectSessionManager, 'sessions' | 'activeSession'>, desktop: DesktopMcpEditorApi,
	capturePreview = captureProjectPreview): () => void {
	const pending = new Map<string, { controller: AbortController; projectSessionId: string | null }>();
	const captures = new Set<string>();
	let disposed = false;
	const stopCancel = desktop.onMcpCancel(requestId => pending.get(requestId)?.controller.abort(new Error('The MCP request was cancelled.')));
	const stopRequests = desktop.onMcpRequest(request => {
		if (disposed || pending.has(request.requestId)) return;
		const controller = new AbortController();
		const projectSessionId = typeof request.input.projectSessionId === 'string' ? request.input.projectSessionId : null;
		pending.set(request.requestId, { controller, projectSessionId });
		void execute(request, controller.signal).then(result => respond({ requestId: request.requestId, ok: true, result }), error => {
			const message = (error instanceof Error ? error.message : String(error)).slice(0, 10_000);
			const code = controller.signal.aborted ? 'CANCELLED' : /^[A-Z_]+:/.exec(message)?.[0].slice(0, -1) ?? 'OPERATION_FAILED';
			return respond({ requestId: request.requestId, ok: false, error: { code, message } });
		}).finally(() => pending.delete(request.requestId)).catch(console.error);
	});
	// 初回の一覧通知でmain側から要求が届くため、受信口を先に登録しておく。
	const stopSessions = watch(() => projectSessions.sessions.value.map(session => ({ projectSessionId: session.id,
		name: session.projectDisplayName.value, isActive: session === projectSessions.activeSession.value, isScriptRunning: session.scripting.isRunning.value,
		activeSceneId: session.activeSceneId.value })), summaries => {
		for (const request of pending.values()) {
			if (request.projectSessionId != null && !summaries.some(session => session.projectSessionId === request.projectSessionId)) request.controller.abort(new Error('The project session has closed.'));
		}
		void desktop.updateMcpProjectSessions(summaries).catch(console.error);
	}, { immediate: true, flush: 'sync' });

	async function respond(response: McpEditorResponse) {
		if (!disposed) await desktop.respondMcpRequest(response);
	}

	async function execute(request: McpEditorRequest, signal: AbortSignal): Promise<unknown> {
		signal.throwIfAborted();
		if (request.operation === 'search_scripting_api') {
			if (typeof request.input.query !== 'string') throw new Error('Search query must be a string.');
			return searchProjectScriptApi(request.input.query);
		}
		if (request.operation === 'get_scripting_api') {
			const names = request.input.names;
			if (!Array.isArray(names) || names.length < 1 || names.length > 5 || names.some(name => typeof name !== 'string')) throw new Error('Provide between 1 and 5 API names.');
			return names.map(name => getProjectScriptApiReference(name));
		}
		const session = projectSessions.sessions.value.find(candidate => candidate.id === request.input.projectSessionId);
		if (session == null || session.isDisposed) throw new Error('PROJECT_CLOSED: The project session is no longer open.');
		if (request.operation === 'execute_script') {
			if (typeof request.input.source !== 'string') throw new Error('Script source must be a string.');
			if (captures.has(session.id)) throw new Error('PROJECT_BUSY: A preview capture is already running.');
			return session.scripting.runExternal(request.input.source, signal, 'MCP: Run script');
		}
		if (request.operation !== 'capture_preview' && request.operation !== 'seek_timeline_and_capture') throw new Error('Unknown editor operation.');
		if (session !== projectSessions.activeSession.value) throw new Error('PREVIEW_INACTIVE: Select this project tab before capturing its preview.');
		if (captures.has(session.id) || session.scripting.isRunning.value) throw new Error('PROJECT_BUSY: A script or preview capture is already running.');
		const maximumSize = request.input.maxSize ?? 1024;
		if (typeof maximumSize !== 'number') throw new Error('maxSize must be a number.');
		captures.add(session.id);
		let selectionChanged = false;
		const stopSelectionWatch = watch(projectSessions.activeSession, active => { if (active !== session) selectionChanged = true; }, { flush: 'sync' });
		try {
			let image;
			if (request.operation === 'seek_timeline_and_capture') {
				const { sceneId, timeMs } = request.input;
				if (typeof sceneId !== 'string' || sceneId.length === 0 || typeof timeMs !== 'number' || !Number.isFinite(timeMs) || timeMs < 0) throw new Error('Invalid Scene ID or time.');
				image = await seekTimelineAndCapture(session, sceneId, timeMs, maximumSize, signal, capturePreview);
			} else image = await capturePreview(session, maximumSize, signal);
			signal.throwIfAborted();
			if (selectionChanged || session !== projectSessions.activeSession.value) throw new Error('PREVIEW_CHANGED: The selected project changed while capturing.');
			return image;
		} finally { stopSelectionWatch(); captures.delete(session.id); }
	}

	return () => {
		if (disposed) return;
		disposed = true;
		stopSessions();
		stopRequests();
		stopCancel();
		for (const request of pending.values()) request.controller.abort(new Error('The editor window has closed.'));
		pending.clear();
		void desktop.updateMcpProjectSessions([]).catch(console.error);
	};
}
