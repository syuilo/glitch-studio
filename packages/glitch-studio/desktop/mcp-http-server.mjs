import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod';

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;
const MAX_SCRIPT_CHARACTERS = 100_000;

const instructions = 'Control open Glitch Studio projects using AiScript. First call list_project_sessions and get_scripting_guide, then search_scripting_api and get_scripting_api for the exact Command/Query contracts. Always use an explicit projectSessionId. execute_script edits are undoable but successful edits remain after an error. capture_preview returns the selected preview as an image. seek_timeline_and_capture pauses and moves the active Timeline Scene. Saving and importing files are not exposed.';

const scriptingGuide = `Glitch Studio project scripting uses AiScript, not JavaScript.
Call list_project_sessions to select an explicit projectSessionId. Session IDs expire when the project is closed.
Call search_scripting_api with a name or purpose, then get_scripting_api with the returned full names (Command:... or Query:...). Contracts describe exact inputs, results and examples for the running app version.

Example:
~~~aiscript
let fill = Query:getEffect({ effectSource: { type: "nativeEffect", id: "fill" } })
let nodesEffect = Command:createNodesEffect({ name: "Generated" })
let node = Command:createNodesEffectEffectNode({
  nodesEffect: nodesEffect
  effectSource: fill.effectSource
  connectionMode: "appendToPrimaryOutput"
})
<: Query:getNode(node)
~~~

Use let for immutable variables and var for mutable variables. Objects use { key: value }; arrays use [value, value]. No JavaScript await is needed: Command and Query calls wait for their result. Output values with <: value. Each execution starts with fresh variables.
Query:listEffects() lists Native Effects and registered Custom Shader Effects. Pass a listed entry's target to Query:getEffect to inspect its parameters and outputs. Use its effectSource when creating an Effect node or Timeline Effect layer.
Query:listNodesEffects() lists registered Nodes Effects. For an entry whose target contains nodesEffectId, use { type: "nodesEffectReference", id: entry.target.nodesEffectId } as its effectSource.
Color literals use linear sRGB; negative values and values above 1 can be valid HDR data. Public spatial coordinates use the full longer edge as 1, center [0, 0], right +X and up +Y. Consult each contract for time units.
One script execution forms one Undo group. Successful changes remain when a later operation fails or is cancelled; review the result before retrying, since repeating a script can duplicate objects. Manual edits may join the same group. Only one script can run in a project at a time.
Dialog APIs are unavailable through MCP. Script source is limited to 100,000 characters, execution to 30 seconds, and output is bounded. Scripts also have an interpreter step limit. They cannot save projects, import assets, access the filesystem or call Node.js APIs.
Command completion means state changes were applied, not that GPU rendering succeeded. After editing, use capture_preview for the active project's selected preview; inactive previews are unavailable. The image represents the current preview including its display adjustments, not an HDR export. Check returned target and time metadata.
`;

function textResult(value, isError = false) {
	const text = typeof value === 'string' ? value : JSON.stringify(value);
	if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RESULT_BYTES) throw new Error('MCP result is too large. Request fewer API definitions or a smaller result.');
	return { content: [{ type: 'text', text }], isError };
}

function errorMessage(error) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 4_000);
}

function rejectRequest(response, status, message) {
	response.writeHead(status, {
		'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close',
		...(status === 401 ? { 'WWW-Authenticate': 'Bearer realm="Glitch Studio MCP"' } : {}),
		...(status === 405 ? { Allow: 'POST' } : {}),
	});
	response.end(message);
}

/**
 * HTTPとMCPの寿命だけを所有する。プロジェクトの所在・状態やElectronのIPCは
 * invokeへ委譲し、公式SDKの同じツール定義で現行仕様と旧Streamable HTTPを扱う。
 */
export async function startMcpHttpServer({ port, token, allowEditing, invoke, version, onActivity = () => {} }) {
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid MCP port');
	if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) throw new Error('Invalid MCP token');
	const authorization = Buffer.from(`Bearer ${token}`);
	const lifetime = new globalThis.AbortController();
	let closing = false;
	let closePromise = null;
	let listeningPort = port;
	const sessionIdSchema = z.string().min(1).max(256);

	const handler = createMcpHandler(() => {
		const server = new McpServer({ name: 'glitch-studio', version }, { instructions });
		const register = (name, description, inputSchema, readOnly, execute, annotations = null) => {
			server.registerTool(name, {
				description, inputSchema,
				annotations: annotations ?? { readOnlyHint: readOnly, destructiveHint: !readOnly, idempotentHint: readOnly, openWorldHint: false },
			}, async (input, context) => {
				const startedAt = Date.now();
				let failure = null;
				try {
					// ツール一覧から隠すこと自体を権限制御にしない。実行入口でも確認する。
					if (!readOnly && !allowEditing) throw new Error('MCP editing is disabled');
					const signal = globalThis.AbortSignal.any([lifetime.signal, context.mcpReq.signal]);
					signal.throwIfAborted();
					const { activityError = null, ...result } = await execute(input, signal);
					signal.throwIfAborted();
					if (result.isError === true) failure = activityError == null ? 'Tool failed' : String(activityError).slice(0, 4_000);
					return result;
				} catch (error) {
					failure = errorMessage(error);
					return textResult(failure, true);
				} finally {
					// 操作履歴には認証情報・スクリプト本文・画像を残さず、結果だけを通知する。
					try {
						onActivity({ tool: name, projectSessionId: input.projectSessionId ?? null, startedAt, durationMs: Date.now() - startedAt, error: failure });
					} catch (error) {
						console.error('Could not record MCP activity:', error);
					}
				}
			});
		};
		register('list_project_sessions', 'List open projects, session IDs, selected Scene IDs and active/running state. Always select an explicit projectSessionId before editing or capturing.',
			z.strictObject({}), true, async (input, signal) => textResult(await invoke('list_project_sessions', input, signal)));
		register('get_scripting_guide', 'Read the AiScript syntax, project editing workflow and execution limits before writing a script.',
			z.strictObject({}), true, async () => textResult(scriptingGuide));
		register('search_scripting_api', 'Search public Command and Query names and descriptions. Retrieve full contracts with get_scripting_api.',
			z.strictObject({ query: z.string().max(1_000) }), true, async (input, signal) => textResult(await invoke('search_scripting_api', input, signal)));
		register('get_scripting_api', 'Get exact input/result schemas and AiScript examples for up to five full API names returned by search_scripting_api.',
			z.strictObject({ names: z.array(z.string().min(1).max(256)).min(1).max(5) }), true, async (input, signal) => textResult(await invoke('get_scripting_api', input, signal)));
		if (allowEditing) {
			register('execute_script', 'Execute AiScript in an explicit project session. Successful edits remain on errors and form one Undo group. Use <: to return output. Dialogs, saving and importing are unavailable. Do not automatically retry after a connection failure.',
				z.strictObject({ projectSessionId: sessionIdSchema, source: z.string().min(1).max(MAX_SCRIPT_CHARACTERS) }), false,
				async (input, signal) => {
					const result = await invoke('execute_script', input, signal);
					return { ...textResult(result, result.error != null), activityError: result.error };
				});
		}
		const imageResult = async (operation, input, signal) => {
			const { data, mimeType, ...metadata } = await invoke(operation, input, signal);
			if (mimeType !== 'image/png' || typeof data !== 'string' || data.length > MAX_RESULT_BYTES) throw new Error('Invalid or oversized preview image');
			const result = { content: [...textResult(metadata).content, { type: 'image', data, mimeType }] };
			if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT_BYTES) throw new Error('Preview result is too large');
			return result;
		};
		register('capture_preview', 'Capture the active project\'s selected preview as a PNG, including display adjustments. Returns target/time metadata. Inactive or unavailable previews return an error; this does not change project or tab selection.',
			z.strictObject({ projectSessionId: sessionIdSchema, maxSize: z.number().int().min(64).max(2048).optional() }), true,
			(input, signal) => imageResult('capture_preview', input, signal));
		register('seek_timeline_and_capture', 'Pause playback, seek the active project and selected Scene to a frame near timeMs, and return its PNG and requested/actual time. Leaves the timeline paused at that position, including on cancellation. Scene selection must match activeSceneId from list_project_sessions. Rendering history can affect the image.',
			z.strictObject({ projectSessionId: sessionIdSchema, sceneId: z.string().min(1).max(256), timeMs: z.number().finite().min(0), maxSize: z.number().int().min(64).max(2048).optional() }), true,
			(input, signal) => imageResult('seek_timeline_and_capture', input, signal),
			{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
		return server;
	}, { legacy: 'stateless', responseMode: 'sse', maxRequestBodySize: MAX_REQUEST_BYTES, maxSubscriptions: 0 });
	const serve = toNodeHandler(handler, { maxRequestBodySize: MAX_REQUEST_BYTES });
	const httpServer = createServer((request, response) => {
		response.setHeader('Cache-Control', 'no-store');
		if (closing) { rejectRequest(response, 503, 'MCP server is stopping'); return; }
		// ブラウザーからの接続は初期版の対象外。ローカルの任意Webページにも許可せず、
		// Originを送らないネイティブクライアントだけを認証付きで受け付ける。
		if (request.headers.origin != null || ![`127.0.0.1:${listeningPort}`, `localhost:${listeningPort}`].includes(request.headers.host)) {
			rejectRequest(response, 403, 'Invalid MCP origin or host'); return;
		}
		const received = Buffer.from(request.headers.authorization ?? '');
		if (received.length !== authorization.length || !timingSafeEqual(received, authorization)) {
			rejectRequest(response, 401, 'MCP authentication required'); return;
		}
		if (request.url !== '/mcp') { rejectRequest(response, 404, 'Not found'); return; }
		if (request.method !== 'POST') { rejectRequest(response, 405, 'Method not allowed'); return; }
		void serve(request, response).catch(error => {
			if (!response.headersSent && !response.destroyed) rejectRequest(response, 500, 'MCP request failed');
			else response.destroy();
			console.error('MCP transport failed:', error);
		});
	});
	httpServer.requestTimeout = 30_000;
	httpServer.headersTimeout = 10_000;
	httpServer.maxConnections = 64;
	try {
		await new Promise((resolve, reject) => {
			httpServer.once('error', reject);
			httpServer.listen(port, '127.0.0.1', () => { httpServer.removeListener('error', reject); resolve(); });
		});
		listeningPort = httpServer.address().port;
	} catch (error) {
		await handler.close();
		throw error;
	}
	return {
		port: listeningPort,
		close() {
			if (closePromise != null) return closePromise;
			closing = true;
			lifetime.abort(new Error('MCP server stopped'));
			const closed = new Promise(resolve => httpServer.close(resolve));
			// SSEとkeep-aliveを含めて閉じる。クライアントが接続を維持していても、
			// 設定変更やアプリ終了でポートの解放を無期限に待たない。
			httpServer.closeAllConnections();
			closePromise = Promise.all([handler.close(), closed]).then(() => {});
			return closePromise;
		},
	};
}
