import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ref } from 'vue';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

async function buildCloseGuard(electron) {
	const bundle = await build({
		absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
		entryPoints: ['./src/project-close-guard.ts'], bundle: true, platform: 'node', format: 'cjs',
		external: ['vue'], write: false, define: { __ELECTRON__: String(electron) },
		plugins: [i18nPlugin, { name: 'close-guard-dialog', setup(builder) {
			builder.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'close-guard-dialog' }));
			builder.onLoad({ filter: /.*/, namespace: 'close-guard-dialog' }, () => ({ contents: `
				export function alert(options) { window.closeNotices.push(options); return window.dismissCloseNotice.promise; }
				export function confirm(options) {
					const completion = Promise.withResolvers();
					window.closeConfirmations.push({ options, completion }); return completion.promise;
				}
			` }));
		} }],
	});
	const bundled = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
	return bundled.exports.installProjectCloseGuard;
}

const installBrowserGuard = await buildCloseGuard(false);
const installDesktopGuard = await buildCloseGuard(true);

function fixture(t, install, { saving = false, exporting = false, unsaved = false, bridgeAvailable = true } = {}) {
	const previousWindow = globalThis.window;
	const target = new EventTarget();
	target.closeNotices = [];
	target.dismissCloseNotice = Promise.withResolvers();
	target.closeConfirmations = [];
	target.completedRequests = [];
	target.resumeAllowed = true;
	target.resumedUnloads = [];
	let listener = null;
	let nextRequestId = 0;
	function close() {
		const event = new Event('beforeunload', { cancelable: true });
		// NodeのEvent.returnValueはDOMのBeforeUnloadEventとは別のプロパティなので置き換える。
		Object.defineProperty(event, 'returnValue', { value: '', writable: true });
		target.dispatchEvent(event);
		return event;
	}
	target.desktop = bridgeAvailable ? {
		onProjectCloseRequested(callback) { listener = callback; return () => { listener = null; }; },
		async completeProjectClose(requestId, confirmed) {
			target.completedRequests.push({ requestId, confirmed });
			if (!confirmed || !target.resumeAllowed) return false;
			target.resumedUnloads.push(close());
			return true;
		},
	} : null;
	globalThis.window = target;
	const isProjectSaving = ref(saving);
	const isExporting = ref(exporting);
	const hasUnsavedChanges = ref(unsaved);
	const dispose = install(isProjectSaving, isExporting, hasUnsavedChanges);
	t.after(() => { dispose(); globalThis.window = previousWindow; });
	return { target, isProjectSaving, isExporting, hasUnsavedChanges, dispose, close,
		request() { const event = close(); if (event.defaultPrevented) listener?.(++nextRequestId); return event; },
		notify(requestId) { nextRequestId = Math.max(nextRequestId, requestId); listener?.(requestId); },
	};
}

async function flushConfirmation() {
	// ダイアログの返答と非同期IPCの完了を、タイマーを使わず待つ。
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

// 【Web版は保存中だけ標準の終了確認を要求し、保存完了・破棄では解除する】
// 手動保存の直後のcloseに間に合うよう、次のVue更新を待たずに保護する必要がある。
// 未保存の変更だけではWeb版の終了を止めたり、Vueのダイアログを併用したりしない。
test('requests browser confirmation synchronously only while saving and cleans up on disposal', t => {
	const fixtureState = fixture(t, installBrowserGuard, { unsaved: true });
	assert.equal(fixtureState.close().defaultPrevented, false);
	fixtureState.isProjectSaving.value = true;
	const blocked = fixtureState.close();
	assert.equal(blocked.defaultPrevented, true);
	assert.equal(blocked.returnValue, true);
	assert.deepEqual(fixtureState.target.closeNotices, []);
	assert.deepEqual(fixtureState.target.closeConfirmations, []);
	fixtureState.isProjectSaving.value = false;
	assert.equal(fixtureState.close().defaultPrevented, false);
	fixtureState.isProjectSaving.value = true;
	fixtureState.dispose();
	assert.equal(fixtureState.close().defaultPrevented, false);
	fixtureState.isProjectSaving.value = false;
	fixtureState.isProjectSaving.value = true;
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【保存中は既存の案内を一つだけ表示し、保存完了後も自動では閉じない】
// mainからの確認通知より先に保存が終わる場合も、保存中の終了禁止を破棄確認へ変えない。
test('keeps blocking saves with one notice and never resumes a close blocked while saving', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { saving: true, unsaved: true });
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.deepEqual(fixtureState.target.closeNotices, [{ type: 'info', title: i18n.ts._App.ProjectSaving, text: i18n.ts._App.CannotCloseWhileSaving }]);
	fixtureState.isProjectSaving.value = false;
	fixtureState.notify(1);
	await flushConfirmation();
	assert.deepEqual(fixtureState.target.completedRequests, [{ requestId: 1, confirmed: false }]);
	assert.deepEqual(fixtureState.target.closeConfirmations, []);
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
	fixtureState.target.dismissCloseNotice.resolve();
	await flushConfirmation();
	fixtureState.isProjectSaving.value = true;
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.target.closeNotices.length, 2);
	fixtureState.hasUnsavedChanges.value = false;
	fixtureState.isProjectSaving.value = false;
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【終了取消後の通知からVueの確認を開き、キャンセルを既定の選択にする】
// beforeunload内で非同期の返答を待つことはできないため、mainが取消を受け取った後に表示する。
// 一度許可しても、その後の別の終了要求へ許可を持ち越さない。
test('uses asynchronous Vue confirmation and approves only one resumed unload', async t => {
	const fixtureState = fixture(t, installDesktopGuard);
	assert.equal(fixtureState.close().defaultPrevented, false);
	fixtureState.hasUnsavedChanges.value = true;
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.target.closeConfirmations.length, 0);
	fixtureState.notify(1);
	assert.deepEqual(fixtureState.target.closeConfirmations[0].options, {
		type: 'warning', title: i18n.ts._App.ConfirmCloseUnsavedProject,
		text: i18n.ts._App.UnsavedChangesWillBeLost,
		okText: i18n.ts._App.CloseWithoutSaving, cancelText: i18n.ts.Cancel, autofocusAction: 'cancel',
	});
	fixtureState.target.closeConfirmations[0].completion.resolve({ canceled: true });
	await flushConfirmation();
	assert.deepEqual(fixtureState.target.completedRequests, [{ requestId: 1, confirmed: false }]);
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
	fixtureState.request();
	fixtureState.target.closeConfirmations[1].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.resumedUnloads.length, 1);
	assert.equal(fixtureState.target.resumedUnloads[0].defaultPrevented, false);
	assert.equal(fixtureState.close().defaultPrevented, true);
});

// 【確認待ちに保存が始まった場合やmainが再開を拒否した場合は終了を許可しない】
// ユーザーが破棄を選んでも、保存中のファイルや更新準備中のプロセスを終了させない。
test('rechecks saving and clears one-time approval when resumption is rejected', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { unsaved: true });
	fixtureState.request();
	fixtureState.isProjectSaving.value = true;
	fixtureState.target.closeConfirmations[0].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.completedRequests[0].confirmed, false);
	fixtureState.isProjectSaving.value = false;
	fixtureState.target.resumeAllowed = false;
	fixtureState.request();
	fixtureState.target.closeConfirmations[1].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
	assert.equal(fixtureState.close().defaultPrevented, true);
});

// 【破棄時に購読を解除し、残っていたダイアログの返答で終了を再開しない】
// 古い画面から遅れて返る確認結果で、別の画面を閉じることを防ぐ。
test('unsubscribes and rejects pending confirmation when the guard is disposed', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { unsaved: true });
	fixtureState.request();
	fixtureState.dispose();
	fixtureState.target.closeConfirmations[0].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.completedRequests.every(request => !request.confirmed), true);
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
	fixtureState.notify(2);
	assert.equal(fixtureState.target.closeConfirmations.length, 1);
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【Electronの確認APIがない場合は未保存のまま終了させない】
// preloadの初期化に問題があっても、確認を省略してデータを失わないようにする。
test('blocks unsaved desktop closing when the desktop bridge is unavailable', t => {
	const fixtureState = fixture(t, installDesktopGuard, { unsaved: true, bridgeAvailable: false });
	assert.equal(fixtureState.close().defaultPrevented, true);
});

// 【Web版はエクスポート開始直後から標準の終了確認を要求し、保存も完了してから解除する】
// Vueの次の更新までの隙間や、保存と書き出しが重なった状態で片方だけが完了した隙間に
// ウィンドウを閉じて進行中の処理を失わないようにする。
test('protects browser exports synchronously until both exporting and saving finish', t => {
	const fixtureState = fixture(t, installBrowserGuard);
	fixtureState.isExporting.value = true;
	assert.equal(fixtureState.close().defaultPrevented, true);
	fixtureState.isProjectSaving.value = true;
	fixtureState.isExporting.value = false;
	assert.equal(fixtureState.close().defaultPrevented, true);
	fixtureState.isExporting.value = true;
	fixtureState.isProjectSaving.value = false;
	assert.equal(fixtureState.close().defaultPrevented, true);
	fixtureState.isExporting.value = false;
	assert.equal(fixtureState.close().defaultPrevented, false);
	assert.deepEqual(fixtureState.target.closeNotices, []);
});

// 【保存済みでもエクスポート中の終了を止め、完了後に古い終了要求を再開しない】
// 書き出し設定などの未保存変更が偶然ある場合だけ保護される実装にしない。
// mainへの通知前に処理が終わっても、ユーザーがもう一度閉じるまでは画面を維持する。
test('blocks saved desktop exports with one notice and does not resume after export completion', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { exporting: true });
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.deepEqual(fixtureState.target.closeNotices, [{ type: 'info', title: i18n.ts._App.Exporting, text: i18n.ts._App.CannotCloseWhileExporting }]);
	fixtureState.isExporting.value = false;
	fixtureState.notify(1);
	await flushConfirmation();
	assert.deepEqual(fixtureState.target.completedRequests, [{ requestId: 1, confirmed: false }]);
	assert.deepEqual(fixtureState.target.closeConfirmations, []);
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【エクスポート中は未保存変更の破棄確認を表示せず、完了後に通常の確認へ戻す】
// 「保存せずに閉じる」を選べる状態にすると、進行中の書き出しまで中断してしまう。
test('prioritizes exporting over unsaved confirmation and restores confirmation after exporting', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { exporting: true, unsaved: true });
	fixtureState.request();
	await flushConfirmation();
	assert.deepEqual(fixtureState.target.closeConfirmations, []);
	assert.equal(fixtureState.target.completedRequests[0].confirmed, false);
	fixtureState.isExporting.value = false;
	fixtureState.request();
	assert.equal(fixtureState.target.closeConfirmations.length, 1);
	fixtureState.target.closeConfirmations[0].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.resumedUnloads[0].defaultPrevented, false);
});

// 【未保存変更の確認中にエクスポートが始まった場合も終了を許可しない】
// ダイアログを開いた時点の状態だけで判断せず、返答時の書き出しを保護する。
test('rejects discard confirmation if an export starts while waiting for the answer', async t => {
	const fixtureState = fixture(t, installDesktopGuard, { unsaved: true });
	fixtureState.request();
	fixtureState.isExporting.value = true;
	fixtureState.target.closeConfirmations[0].completion.resolve({ canceled: false });
	await flushConfirmation();
	assert.equal(fixtureState.target.completedRequests[0].confirmed, false);
	assert.equal(fixtureState.target.resumedUnloads.length, 0);
});
