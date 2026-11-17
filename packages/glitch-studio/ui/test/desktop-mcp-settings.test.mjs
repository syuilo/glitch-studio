import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	entryPoints: ['./src/desktop-mcp-settings.ts'], external: ['vue'] });
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { DesktopMcpSettings, createMcpClientConfiguration } = loaded.exports;

function state(revision, patch = {}) {
	return { revision, settings: { enabled: false, port: 45721, allowEditing: false }, status: 'stopped',
		url: 'http://127.0.0.1:45721/mcp', token: 'initial-token', error: null, activity: [], ...patch };
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
	return { promise, resolve, reject };
}

function host(overrides = {}) {
	let listener = null;
	let unsubscribed = false;
	const api = {
		async getMcpServerState() { return state(0); },
		async setMcpServerSettings() { throw new Error('Unexpected setting change'); },
		async regenerateMcpServerToken() { throw new Error('Unexpected token regeneration'); },
		onMcpServerStateChanged(callback) { listener = callback; return () => { unsubscribed = true; }; },
		...overrides,
	};
	return { api, notify: value => listener(value), get unsubscribed() { return unsubscribed; } };
}

// 【設定を開くだけではサーバーを起動せず、新しい通知を初回取得で巻き戻さない】
// 複数ウィンドウで操作した際、取得待ちの間にトークンや状態が変わることがある。
// 遅延したsnapshotがその更新を上書きせず、読み取り時に設定保存を呼ばないことを確認する。
test('keeps newer broadcasts while loading settings without writing them', async () => {
	const initial = deferred();
	const desktop = host({ getMcpServerState: () => initial.promise });
	const controller = new DesktopMcpSettings(desktop.api);
	const connecting = controller.connect();
	desktop.notify(state(2, { token: 'rotated-token', status: 'running' }));
	initial.resolve(state(1));
	await connecting;
	assert.equal(controller.state.value.token, 'rotated-token');
	assert.equal(controller.state.value.status, 'running');
	assert.equal(controller.busy.value, false);
	controller.dispose();
	assert.equal(desktop.unsubscribed, true);
});

// 【変更する項目だけを最新設定へ反映し、保存中の追加操作を受け付けない】
// 古い既定値で他の設定を消さず、連打によって複数の起動・停止が並行しないようにする。
// 保存結果より新しい実行履歴の通知も維持する。
test('merges a setting change with current state and rejects overlapping submissions', async () => {
	const pending = deferred();
	const submitted = [];
	const desktop = host({
		async getMcpServerState() { return state(1, { settings: { enabled: true, port: 45722, allowEditing: false } }); },
		setMcpServerSettings(settings) { submitted.push(settings); return pending.promise; },
	});
	const controller = new DesktopMcpSettings(desktop.api);
	await controller.connect();
	const saving = controller.update({ allowEditing: true });
	await controller.update({ enabled: false });
	assert.deepEqual(submitted, [{ enabled: true, port: 45722, allowEditing: true }]);
	const latest = state(4, { settings: submitted[0], activity: [{ id: 'run', tool: 'execute_script', startedAt: 1, finishedAt: 2, error: null }] });
	desktop.notify(latest);
	pending.resolve(state(3, { settings: submitted[0] }));
	await saving;
	assert.deepEqual(controller.state.value, latest);
	controller.dispose();
});

// 【再発行したトークンを接続設定へ反映し、再発行に失敗した場合は元の設定を保つ】
// UIが存在しないトークンをコピーさせたり、認証情報を誤ったキーで出力したりすると、
// 正しいURLでもクライアントが接続できなくなる。
test('copies current credentials after rotation and retains state after a failed change', async () => {
	const desktop = host({
		async regenerateMcpServerToken() { return state(1, { token: 'new-token' }); },
		async setMcpServerSettings() { throw new Error('Could not save MCP settings'); },
	});
	const controller = new DesktopMcpSettings(desktop.api);
	await controller.connect();
	await controller.regenerateToken();
	const configuration = createMcpClientConfiguration('codex', controller.state.value);
	assert.match(configuration, /^\[mcp_servers\.glitch_studio\]/);
	assert.match(configuration, /http_headers = \{ Authorization = "Bearer new-token" \}/);
	const claude = JSON.parse(createMcpClientConfiguration('claude', controller.state.value));
	assert.deepEqual(claude.mcpServers.glitch_studio, { type: 'http', url: controller.state.value.url, headers: { Authorization: 'Bearer new-token' } });
	await controller.update({ enabled: true });
	assert.equal(controller.state.value.settings.enabled, false);
	assert.equal(controller.error.value, 'Could not save MCP settings');
	assert.equal(controller.busy.value, false);
	controller.dispose();
});

// 【画面を閉じた後に到着した要求結果や通知を破棄する】
// 設定ダイアログの寿命が終わった後に表示用の状態を再生成しない。
test('ignores late responses and notifications after disposal', async () => {
	const initial = deferred();
	const desktop = host({ getMcpServerState: () => initial.promise });
	const controller = new DesktopMcpSettings(desktop.api);
	const connecting = controller.connect();
	controller.dispose();
	initial.resolve(state(1));
	await connecting;
	desktop.notify(state(2));
	assert.equal(controller.state.value, null);
	assert.equal(desktop.unsubscribed, true);
});
