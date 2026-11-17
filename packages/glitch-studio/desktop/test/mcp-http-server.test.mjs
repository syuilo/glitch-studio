import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { startMcpHttpServer } from '../mcp-http-server.mjs';

const token = 'a'.repeat(64);

async function start(t, options = {}) {
	const server = await startMcpHttpServer({ port: 0, token, allowEditing: true, version: 'test', invoke: async () => [], ...options });
	t.after(() => server.close());
	const url = `http://127.0.0.1:${server.port}/mcp`;
	let nextId = 0;
	const send = (method, parameters = {}, { legacy = false, signal, ...options } = {}) => {
		const params = legacy ? parameters : { ...parameters, _meta: {
			'io.modelcontextprotocol/protocolVersion': '2026-07-28',
			'io.modelcontextprotocol/clientInfo': { name: 'glitch-studio-test', version: '1.0.0' },
			'io.modelcontextprotocol/clientCapabilities': {},
		} };
		return fetch(url, { method: 'POST', signal, headers: {
			Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
			...(legacy ? {} : { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method, ...(parameters.name == null ? {} : { 'Mcp-Name': parameters.name }) }),
		}, body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }), ...options });
	};
	return { server, url, send, async call(name, args = {}, options) { return readResult(await send('tools/call', { name, arguments: args }, options)); } };
}

async function readResult(response) {
	const body = await response.text();
	assert.equal(response.status, 200, body);
	if (response.headers.get('content-type')?.includes('text/event-stream')) {
		const messages = body.split('\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim()));
		const message = messages.findLast(value => value.result != null || value.error != null);
		assert.ok(message, body);
		return message;
	}
	return JSON.parse(body);
}

// 【現行仕様と旧Streamable HTTPで同じ公開APIを利用できる】
// 接続先クライアントの更新時期に依存せず、公式SDKの両経路で実際のツール呼び出しを検証する。
test('serves modern and legacy discovery and forwards validated tool calls', async t => {
	const calls = [];
	const api = await start(t, { invoke: async (operation, input) => { calls.push({ operation, input }); return [{ projectSessionId: 'project-1', name: 'Project' }]; } });
	const modern = await readResult(await api.send('tools/list'));
	assert.ok(modern.result.tools.some(tool => tool.name === 'execute_script'));
	assert.ok(modern.result.tools.some(tool => tool.name === 'capture_preview'));
	const initialized = await readResult(await api.send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1.0.0' } }, { legacy: true }));
	assert.equal(initialized.result.serverInfo.name, 'glitch-studio');
	const legacy = await readResult(await api.send('tools/list', {}, { legacy: true }));
	assert.deepEqual(legacy.result.tools.map(tool => tool.name), modern.result.tools.map(tool => tool.name));
	for (const options of [{}, { legacy: true }]) {
		const result = await api.call('list_project_sessions', {}, options);
		assert.equal(JSON.parse(result.result.content[0].text)[0].projectSessionId, 'project-1');
	}
	assert.deepEqual(calls, [{ operation: 'list_project_sessions', input: {} }, { operation: 'list_project_sessions', input: {} }]);
});

// 【認証と接続元検証をプロジェクトへのアクセスより前に行う】
// ループバックであってもWebサイトや誤ったHostから編集APIを操作できないことを保証する。
test('rejects missing credentials, browser origins, other hosts and unexpected routes', async t => {
	let invoked = false;
	const api = await start(t, { invoke: async () => { invoked = true; } });
	assert.equal((await fetch(api.url, { method: 'POST' })).status, 401);
	assert.equal((await fetch(api.url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status, 401);
	for (const origin of ['https://example.com', 'http://127.0.0.1:1234', 'null']) {
		assert.equal((await fetch(api.url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin } })).status, 403);
	}
	const hostStatus = await new Promise((resolve, reject) => {
		const request = httpRequest(api.url, { method: 'POST', headers: { Host: 'example.com', Authorization: `Bearer ${token}` } }, response => { response.resume(); resolve(response.statusCode); });
		request.on('error', reject);
		request.end();
	});
	assert.equal(hostStatus, 403);
	assert.equal((await fetch(`${api.url}?token=ignored`, { headers: { Authorization: `Bearer ${token}` } })).status, 404);
	assert.equal((await fetch(api.url, { headers: { Authorization: `Bearer ${token}` } })).status, 405);
	assert.equal(invoked, false);
});

// 【読み取り専用設定では編集ツールを直接指定しても実行できない】
// tools/listの表示を信頼せず、古い一覧を保持するクライアントからの呼び出しも拒否する。
test('does not expose or execute scripts while editing is disabled', async t => {
	let invoked = false;
	const api = await start(t, { allowEditing: false, invoke: async () => { invoked = true; } });
	const listing = await readResult(await api.send('tools/list'));
	assert.equal(listing.result.tools.some(tool => tool.name === 'execute_script'), false);
	const result = await api.call('execute_script', { projectSessionId: 'project', source: '<: 1' });
	assert.ok(result.error != null || result.result?.isError === true);
	assert.equal(invoked, false);
});

// 【編集禁止でもシーク画像を取得でき、画面への副作用をツール一覧で伝える】
// 読み取り専用プロジェクトの確認を可能にしつつ、MCPクライアントがシークを純粋な読み取りと誤認しない。
test('exposes timeline seek and image capture with editing disabled', async t => {
	const calls = [];
	const api = await start(t, { allowEditing: false, invoke: async (operation, input) => {
		calls.push({ operation, input });
		return { data: 'iVBORw0KGgo=', mimeType: 'image/png', timeMs: 120, requestedTimeMs: 110, wasPlaying: true };
	} });
	const listing = await readResult(await api.send('tools/list'));
	const tool = listing.result.tools.find(candidate => candidate.name === 'seek_timeline_and_capture');
	assert.equal(tool.annotations.readOnlyHint, false);
	const input = { projectSessionId: 'project', sceneId: 'scene', timeMs: 110, maxSize: 64 };
	const result = await api.call('seek_timeline_and_capture', input);
	assert.deepEqual(calls, [{ operation: 'seek_timeline_and_capture', input }]);
	assert.equal(JSON.parse(result.result.content[0].text).timeMs, 120);
	assert.equal(result.result.content[1].type, 'image');
	for (const timeMs of [-1, '100']) {
		const invalid = await api.call('seek_timeline_and_capture', { ...input, timeMs });
		assert.ok(invalid.error != null || invalid.result?.isError === true);
	}
	assert.equal(calls.length, 1);
});

// 【途中失敗の成功済み変更と画像をMCPの結果として区別する】
// 編集済み状態を失敗だけで隠さず、画像は文字列ではなくモデルが読めるimageコンテンツにする。
test('returns partial script failures and native images without recording source or output in activity', async t => {
	const activity = [];
	const partial = { output: ['private output'], outputTruncated: false, commandsExecuted: 1, error: 'Node missing' };
	const api = await start(t, { onActivity: entry => activity.push(entry), invoke: async operation => operation === 'execute_script' ? partial : {
		data: 'iVBORw0KGgo=', mimeType: 'image/png', width: 64, height: 32, projectSessionId: 'project', time: 0,
	} });
	const executed = await api.call('execute_script', { projectSessionId: 'project', source: '<: "private source"' });
	assert.equal(executed.result.isError, true);
	assert.deepEqual(JSON.parse(executed.result.content[0].text), partial);
	assert.equal(activity[0].error, 'Node missing');
	assert.equal(JSON.stringify(activity).includes('private'), false);
	const captured = await api.call('capture_preview', { projectSessionId: 'project', maxSize: 64 });
	assert.deepEqual(captured.result.content[1], { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' });
	assert.equal(JSON.parse(captured.result.content[0].text).width, 64);
});

// 【入力と出力量の上限を超えた要求で処理や巨大な応答を発生させない】
// 長大なスクリプト・API定義・画像がmainプロセスとクライアントを占有するのを防ぐ。
test('bounds request bodies, script inputs, API batches and result sizes', async t => {
	let calls = 0;
	const api = await start(t, { invoke: async () => { calls++; return 'x'.repeat(16 * 1024 * 1024 + 1); } });
	for (const [name, input] of [
		['execute_script', { projectSessionId: 'project', source: 'x'.repeat(100_001) }],
		['get_scripting_api', { names: Array(6).fill('Command:test') }],
		['capture_preview', { projectSessionId: 'project', maxSize: 4096 }],
	]) {
		const result = await api.call(name, input);
		assert.ok(result.error != null || result.result?.isError === true);
	}
	assert.equal(calls, 0);
	const oversized = await api.send('tools/list', {}, { body: 'x'.repeat(1024 * 1024 + 1) });
	assert.equal(oversized.status, 413);
	const result = await api.call('search_scripting_api', { query: '' });
	assert.equal(result.result.isError, true);
	assert.match(result.result.content[0].text, /too large/);
	assert.equal(calls, 1);
});

// 【クライアント切断とサーバー停止を実行中の編集へ伝播する】
// HTTP接続が消えた後も処理が続いたり、SSEが残って設定変更時に終了できなくなることを防ぐ。
test('cancels active work on disconnect and closes active connections on shutdown', async t => {
	for (const { disconnect, legacy } of [
		{ disconnect: true, legacy: false }, { disconnect: false, legacy: false },
		{ disconnect: true, legacy: true }, { disconnect: false, legacy: true },
	]) {
		const started = Promise.withResolvers();
		const aborted = Promise.withResolvers();
		const api = await start(t, { invoke: async (_operation, _input, signal) => {
			started.resolve();
			return new Promise((resolve, reject) => signal.addEventListener('abort', () => { aborted.resolve(); reject(signal.reason); }, { once: true }));
		} });
		const controller = new AbortController();
		const response = api.send('tools/call', { name: 'execute_script', arguments: { projectSessionId: 'project', source: '<: 1' } }, { signal: controller.signal, legacy });
		const received = response.then(value => value.text()).catch(() => {});
		await started.promise;
		if (disconnect) controller.abort();
		else await api.server.close();
		await aborted.promise;
		await received;
		await api.server.close();
	}
});
