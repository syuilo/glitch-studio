import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	stdin: { loader: 'ts', resolveDir: directory, contents: `
		export { DesktopUpdateUiController } from './src/DesktopUpdateUiController.ts';
		export { DesktopUpdates } from './src/desktop-updates.ts';
		export { updateUiTest } from './src/ui.ts';
	` },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'update-ui-platform', setup(build) {
		// 状態購読・更新準備・UI制御は本体を使い、表示先だけを記録する。
		build.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'platform' }));
		build.onResolve({ filter: /\.vue$/ }, () => ({ path: 'dialog', namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', contents: path === 'dialog' ? 'export default {};' : `
			export const updateUiTest = { confirmations: [], dialogs: [], alerts: [] };
			export function confirm(props) {
				const result = Promise.withResolvers();
				updateUiTest.confirmations.push({ props, ...result });
				return result.promise;
			}
			export function popup(_component, props, events) {
				const dialog = { props, events, disposed: false };
				updateUiTest.dialogs.push(dialog);
				return { dispose() { dialog.disposed = true; } };
			}
			export async function alert(props) { updateUiTest.alerts.push(props); }
		` }));
	} }],
});
const bundled = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
const { DesktopUpdateUiController, DesktopUpdates, updateUiTest } = bundled.exports;

function fixture(t, phase = 'available') {
	updateUiTest.confirmations.length = 0;
	updateUiTest.dialogs.length = 0;
	updateUiTest.alerts.length = 0;
	let listener = null;
	let state = { revision: 0, phase, version: '2.0.0-beta.1', progress: null, error: null };
	const calls = { subscriptions: 0, snapshots: 0, preparedVersions: [], starts: 0 };
	const push = patch => {
		state = { ...state, ...patch, revision: state.revision + 1 };
		listener?.(state);
		return state;
	};
	const updates = new DesktopUpdates({
		getUpdateState: async () => { calls.snapshots++; return state; },
		onUpdateStateChanged: callback => { calls.subscriptions++; listener = callback; return () => { listener = null; }; },
		checkForUpdates: async () => state,
		prepareUpdate: async version => { calls.preparedVersions.push(version); return push({ phase: 'preparing' }); },
		startUpdate: async () => { calls.starts++; return push({ phase: 'downloading' }); },
		abortUpdatePreparation: async () => push({ phase: 'error' }),
	}, {
		reserve: () => () => {},
		pause: async () => async () => {},
	});
	t.after(() => updates.dispose());
	return { controller: new DesktopUpdateUiController(updates), calls, push };
}

// 【コンポーネントを使わず初期化でき、繰り返し呼んでも購読や進捗ダイアログを増やさない】
// main.tsがサービスを開始するため、初期snapshotが処理中でも進捗を表示する必要がある。
// 同じサービスを複数の画面が参照しても、IPC購読と表示は一つのまま共有する。
test('initializes once outside a component and shares live update progress', async t => {
	const { controller, calls, push } = fixture(t, 'downloading');
	await Promise.all([controller.initialize(), controller.initialize()]);
	await nextTick();
	assert.equal(calls.subscriptions, 1);
	assert.equal(calls.snapshots, 1);
	assert.equal(updateUiTest.dialogs.length, 1);
	assert.equal(controller.working.value, true);

	push({ phase: 'installing' });
	await nextTick();
	assert.equal(updateUiTest.dialogs.length, 1);
	assert.equal(updateUiTest.dialogs[0].props.state.value.phase, 'installing');
});

// 【複数の通知からの操作にも確認は一つだけ表示し、キャンセル後は更新を開始しない】
// Dashboardとヘッダが独立した確認を出すと、一方でキャンセルしても別の確認から終了できてしまう。
test('shares one confirmation across callers and requires approval before starting', async t => {
	const { controller, calls, push } = fixture(t);
	await controller.initialize();
	const canceledRequest = controller.requestUpdate();
	await controller.requestUpdate();
	assert.equal(updateUiTest.confirmations.length, 1);
	assert.equal(updateUiTest.dialogs.length, 0);
	assert.deepEqual(calls.preparedVersions, []);
	updateUiTest.confirmations[0].resolve({ canceled: true });
	await canceledRequest;
	assert.equal(calls.starts, 0);

	const approvedRequest = controller.requestUpdate();
	updateUiTest.confirmations[1].resolve({ canceled: false });
	await approvedRequest;
	await setImmediate();
	assert.deepEqual(calls.preparedVersions, ['2.0.0-beta.1']);
	assert.equal(calls.starts, 1);
	assert.equal(updateUiTest.dialogs.length, 1);
	assert.equal(updateUiTest.dialogs[0].props.working.value, true);

	push({ phase: 'error', error: { code: 'download-failed', message: 'offline' } });
	await setImmediate();
	assert.equal(controller.working.value, false);
	updateUiTest.dialogs[0].events.retry();
	assert.equal(updateUiTest.dialogs[0].disposed, true);
	assert.equal(updateUiTest.confirmations.length, 3);
	updateUiTest.confirmations[2].resolve({ canceled: true });
	await setImmediate();
	assert.equal(calls.starts, 1);
});

// 【インストーラー起動後の失敗は通知から再実行せず、再起動の案内を共有する】
// 通知とHelpのどちらを選んでも、mainが再試行できない状態で確認やダウンロードへ戻してはならない。
test('shows restart guidance from notifications and manual checks without retrying', async t => {
	const { controller, calls } = fixture(t, 'restart-required');
	await controller.initialize();
	await controller.requestUpdate();
	await controller.checkForUpdates();
	assert.equal(updateUiTest.dialogs.length, 1);
	assert.equal(updateUiTest.confirmations.length, 0);
	assert.equal(calls.starts, 0);
	assert.equal(controller.working.value, false);
});

// 【手動確認で更新がない場合は結果を案内し、更新開始の確認を表示しない】
// 確認処理をApp.vueから移しても、Helpからの操作に対する結果の通知を維持する。
test('reports that the installed version is current after a manual check', async t => {
	const { controller, push } = fixture(t);
	await controller.initialize();
	push({ phase: 'not-available', version: null });
	await controller.checkForUpdates();
	assert.equal(updateUiTest.alerts.length, 1);
	assert.equal(updateUiTest.alerts[0].type, 'info');
	assert.equal(updateUiTest.confirmations.length, 0);
	assert.equal(updateUiTest.dialogs.length, 0);
});
