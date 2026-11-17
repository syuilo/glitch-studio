import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

// 【実際のHTTP・main・preload・UIを往復し、指定したプロジェクトの編集とUndoを確認する】
// 個別のモックでは見落とすIPCの接続や登録順序を検証する。重い描画の起動だけを省き、
// Command・Query・AiScript実行・資料生成・履歴とMCPの実装は製品コードをそのまま使う。
test('connects the real Electron MCP server to project scripting, references and undo', {
	skip: process.env.GLITCH_ELECTRON_TEST !== '1', timeout: 60_000,
}, async t => {
	const temporaryRoot = path.resolve(os.tmpdir());
	const directory = await fs.mkdtemp(path.join(temporaryRoot, 'glitch-mcp-electron-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
		assert.ok(path.basename(directory).startsWith('glitch-mcp-electron-'));
		await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	});
	const uiDirectory = fileURLToPath(new URL('../../ui/', import.meta.url));
	const bundle = await build({ absWorkingDir: uiDirectory, stdin: { resolveDir: uiDirectory, loader: 'ts', contents: `
		import { computed, ref, shallowRef } from 'vue';
		import { COMMAND_DEFS } from './src/commands.ts';
		import { UndoRedo } from './src/utility/undo-redo.ts';
		import { ProjectScriptingController } from './src/scripting/ProjectScriptingController.ts';
		import { connectMcpEditor } from './src/mcp/editor-connection.ts';
		function createSession(id, name) {
			const state = {
				name: ref(name), description: ref(''), author: ref(''),
				resolution: ref({ width: 1920, height: 1080 }), timelineFps: ref(30),
				timelineMotionBlur: ref({ enabled: false, shutterAngle: 180, samples: 8 }), exportSettings: ref(null),
				automationGraphs: ref([]), customShaderEffects: ref([]), generatedSpeech: ref([]),
				assets: ref([]), players: ref([]), visualModules: ref([]), timelineScenes: ref([]),
			};
			const stateManager = new UndoRedo(state, COMMAND_DEFS);
			const scripting = new ProjectScriptingController(stateManager, {
				dialog: async () => { throw new Error('Unexpected dialog'); },
				showError: async () => { throw new Error('Unexpected panel error'); },
				historyLabel: 'Run script', outputTruncated: 'Output truncated',
			});
			scripting.source.value = 'draft for ' + id;
			scripting.output.value = ['panel output for ' + id];
			const playback = { state: ref({ mode: 'timeline', playing: true }), isTimelinePlaying: ref(true), currentTimelineTime: ref(0),
				pauseTimeline() { this.isTimelinePlaying.value = false; this.state.value = { mode: 'timeline', playing: false }; },
				seekTimeline(time) { this.currentTimelineTime.value = Math.round(time / 40) * 40; } };
			return { id, projectContext: { stateManager }, scripting, projectDisplayName: computed(() => state.name.value), activeSceneId: ref('scene-' + id), previewPlayback: playback, isDisposed: false };
		}
		window.testSessions = [createSession('first', 'First project'), createSession('second', 'Second project')];
		window.testProjectSessions = { sessions: shallowRef(window.testSessions), activeSession: shallowRef(window.testSessions[0]) };
		window.disconnectMcp = connectMcpEditor(window.testProjectSessions, window.desktop, async session => ({
			data: 'iVBORw0KGgo=', mimeType: 'image/png', width: 64, height: 64, projectSessionId: session.id,
			target: { kind: 'timeline', sceneId: session.activeSceneId.value }, timeMs: session.previewPlayback.currentTimelineTime.value,
			colorSpace: 'srgb', includesPreviewAdjustments: true,
		}));
		window.ready = true;
	` }, bundle: true, format: 'esm', platform: 'browser', write: false,
		define: { __ELECTRON__: 'true', 'import.meta.env.DEV': 'false' }, plugins: [{ name: 'mcp-test-effects', setup(builder) {
			builder.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'mcp-test-effects' }));
			builder.onLoad({ filter: /.*/, namespace: 'mcp-test-effects' }, () => ({ loader: 'ts', resolveDir: uiDirectory, contents: `
				import fill from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
				export const effectDefinitions = { fill };
			` }));
		} }],
	});
	await fs.writeFile(path.join(directory, 'editor.js'), bundle.outputFiles[0].text);
	const mainUrl = new URL('../main.mjs', import.meta.url).href;
	const helper = path.join(directory, 'main.cjs');
	await fs.writeFile(helper, `
		const assert = require('node:assert/strict');
		const fs = require('node:fs');
		const path = require('node:path');
		const { once } = require('node:events');
		const { createServer } = require('node:http');
		const { app, BaseWindow, BrowserWindow } = require('electron');
		console.log('MCP_ELECTRON_START');
		let stage = 'starting fixture server';
		const watchdog = setTimeout(() => { console.error('MCP Electron stalled at: ' + stage); app.exit(1); }, 30_000);
		BaseWindow.prototype.show = function () { if (!this.isDestroyed()) this.emit('show'); };
		BaseWindow.prototype.maximize = function () {};
		BaseWindow.prototype.focus = function () {};
		const webServer = createServer((request, response) => {
			response.setHeader('Content-Type', request.url === '/editor.js' ? 'text/javascript' : 'text/html');
			response.end(request.url === '/editor.js' ? fs.readFileSync(path.join(__dirname, 'editor.js')) : '<!doctype html><body><script type="module" src="/editor.js"></script>');
		});
		async function waitFor(predicate) {
			const deadline = Date.now() + 10_000;
			while (!await predicate()) {
				if (Date.now() > deadline) throw new Error('MCP Electron probe timed out');
				await new Promise(resolve => setTimeout(resolve, 20));
			}
		}
		let nextId = 0;
		let mcpState;
		async function request(method, parameters = {}, legacy = false) {
			const params = legacy ? parameters : { ...parameters, _meta: {
				'io.modelcontextprotocol/protocolVersion': '2026-07-28',
				'io.modelcontextprotocol/clientInfo': { name: 'glitch-electron-test', version: '1.0.0' },
				'io.modelcontextprotocol/clientCapabilities': {},
			} };
			const response = await fetch(mcpState.url, { method: 'POST', headers: {
				Authorization: 'Bearer ' + mcpState.token, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
				...(legacy ? {} : { 'MCP-Protocol-Version': '2026-07-28', 'Mcp-Method': method,
					...(parameters.name == null ? {} : { 'Mcp-Name': parameters.name }) }),
			}, body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }) });
			const body = await response.text();
			assert.equal(response.status, 200, body);
			const result = response.headers.get('content-type').includes('text/event-stream')
				? body.split('\\n').filter(line => line.startsWith('data:')).map(line => JSON.parse(line.slice(5).trim())).findLast(message => message.result != null || message.error != null)
				: JSON.parse(body);
			assert.equal(result.error, undefined);
			return result.result;
		}
		const call = (name, input = {}, legacy = false) => request('tools/call', { name, arguments: input }, legacy);
		const data = result => JSON.parse(result.content[0].text);
		(async () => {
			webServer.listen(0, '127.0.0.1'); await once(webServer, 'listening');
			process.env.GLITCH_DESKTOP_TEST_PROFILE = path.join(__dirname, 'profile');
			process.env.GLITCH_DESKTOP_DEV_URL = 'http://127.0.0.1:' + webServer.address().port + '/';
			stage = 'importing actual main';
			await import(${JSON.stringify(mainUrl)});
			stage = 'waiting for editor';
			await waitFor(() => BrowserWindow.getAllWindows().some(window => window.getParentWindow() == null));
			const editor = BrowserWindow.getAllWindows().find(window => window.getParentWindow() == null);
			stage = 'waiting for fixture UI';
			await waitFor(() => editor.webContents.executeJavaScript('window.ready === true').catch(() => false));
			const evaluate = source => editor.webContents.executeJavaScript(source);
			mcpState = await evaluate('window.desktop.getMcpServerState()');
			assert.equal(mcpState.status, 'stopped');
			assert.equal(mcpState.settings.enabled, false);
			assert.equal(mcpState.settings.allowEditing, false);
			const portProbe = createServer(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening');
			const port = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve));
			const settings = { enabled: true, allowEditing: true, port };
			stage = 'enabling MCP';
			mcpState = await evaluate('window.desktop.setMcpServerSettings(' + JSON.stringify(settings) + ')');
			assert.equal(mcpState.status, 'running', mcpState.error ?? 'MCP failed to start');
			assert.equal((await fetch(mcpState.url, { method: 'POST' })).status, 401);
			stage = 'listing project sessions';
			await waitFor(async () => data(await call('list_project_sessions')).length === 2);
			const sessions = data(await call('list_project_sessions'));
			assert.deepEqual(sessions.map(session => [session.projectSessionId, session.name, session.isActive]), [
				['first', 'First project', true], ['second', 'Second project', false],
			]);
			assert.equal(sessions[0].activeSceneId, 'scene-first');
			stage = 'seeking timeline through MCP';
			const image = await call('seek_timeline_and_capture', { projectSessionId: 'first', sceneId: 'scene-first', timeMs: 101, maxSize: 64 });
			assert.equal(image.content[1].type, 'image');
			assert.equal(data(image).timeMs, 120);
			assert.equal(data(image).requestedTimeMs, 101);
			assert.equal(data(image).wasPlaying, true);
			assert.equal(await evaluate('window.testSessions[0].previewPlayback.isTimelinePlaying.value'), false);
			const found = data(await call('search_scripting_api', { query: 'setProjectName' }));
			assert.ok(found.some(entry => entry.name === 'Command:setProjectName'));
			const reference = data(await call('get_scripting_api', { names: ['Command:setProjectName', 'Query:getProject'] }));
			assert.equal(reference[0].inputSchema.properties.name.type, 'string');
			assert.equal(reference[1].kind, 'query');
			stage = 'executing project script';
			const executed = data(await call('execute_script', { projectSessionId: 'second',
				source: 'Command:setProjectName({ name: "Edited second" })\\nlet project = Query:getProject()\\n<: project.name',
			}));
			assert.equal(executed.error, null); assert.equal(executed.commandsExecuted, 1);
			assert.deepEqual(executed.output, ['Edited second']);
			assert.deepEqual(await evaluate('window.testSessions.map(session => ({ name: session.projectDisplayName.value, history: session.projectContext.stateManager.undoStack.value.length, source: session.scripting.source.value, output: session.scripting.output.value }))'), [
				{ name: 'First project', history: 0, source: 'draft for first', output: ['panel output for first'] },
				{ name: 'Edited second', history: 1, source: 'draft for second', output: ['panel output for second'] },
			]);
			assert.equal(await evaluate('window.testProjectSessions.activeSession.value.id'), 'first');
			await evaluate('window.testSessions[1].projectContext.stateManager.undo(); void 0;');
			await request('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } }, true);
			const afterUndo = data(await call('execute_script', { projectSessionId: 'second', source: 'let project = Query:getProject()\\n<: project.name' }, true));
			assert.deepEqual(afterUndo.output, ['Second project']);
			assert.equal(afterUndo.commandsExecuted, 0);
			assert.equal(await evaluate('window.testSessions[1].projectContext.stateManager.redoStack.value.length'), 1);
			await evaluate('window.testSessions[1].projectContext.stateManager.redo(); void 0;');
			const partial = await call('execute_script', { projectSessionId: 'second',
				source: 'Command:setProjectName({ name: "Partial change" })\\nCommand:setProjectResolution({ resolution: { width: 0, height: 100 } })',
			});
			assert.equal(partial.isError, true); assert.equal(data(partial).commandsExecuted, 1);
			assert.equal(await evaluate('window.testSessions[1].projectDisplayName.value'), 'Partial change');
			await evaluate('window.testSessions[1].projectContext.stateManager.undo(); void 0;');
			assert.equal(await evaluate('window.testSessions[1].projectDisplayName.value'), 'Edited second');
			stage = 'rotating token';
			const oldToken = mcpState.token;
			mcpState = await evaluate('window.desktop.regenerateMcpServerToken()');
			assert.equal(mcpState.status, 'running'); assert.ok(mcpState.token !== oldToken);
			assert.equal((await fetch(mcpState.url, { method: 'POST', headers: { Authorization: 'Bearer ' + oldToken } })).status, 401);
			assert.equal(data(await call('list_project_sessions')).length, 2);
			stage = 'stopping MCP';
			mcpState = await evaluate('window.desktop.setMcpServerSettings(' + JSON.stringify({ ...settings, enabled: false }) + ')');
			assert.equal(mcpState.status, 'stopped');
			await assert.rejects(fetch(mcpState.url));
			mcpState = await evaluate('window.desktop.setMcpServerSettings(' + JSON.stringify({ ...settings, allowEditing: false }) + ')');
			assert.equal(mcpState.status, 'running');
			assert.equal((await request('tools/list')).tools.some(tool => tool.name === 'execute_script'), false);
			const saved = JSON.parse(fs.readFileSync(path.join(__dirname, 'profile', 'mcp-server.json'), 'utf8'));
			assert.deepEqual(saved.settings, { ...settings, allowEditing: false });
			assert.ok(saved.token === mcpState.token);
			stage = 'quitting Electron';
			app.once('will-quit', () => { clearTimeout(watchdog); console.log('MCP_ELECTRON_OK'); webServer.close(); });
			app.quit();
		})().catch(error => { console.error(error); app.exit(1); });
	`);
	const executable = createRequire(import.meta.url)('electron');
	const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
	const result = await new Promise((resolve, reject) => {
		const child = spawn(executable, [helper], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', value => { output += value; });
		child.stderr.on('data', value => { output += value; });
		const timer = setTimeout(() => { child.kill(); reject(new Error('Electron MCP test timed out: ' + output)); }, 45_000);
		child.once('error', error => { clearTimeout(timer); reject(error); });
		child.once('exit', code => { clearTimeout(timer); resolve({ code, output }); });
	});
	assert.equal(result.code, 0, result.output);
	assert.match(result.output, /MCP_ELECTRON_OK/);
});
