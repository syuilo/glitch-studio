import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ref } from 'vue';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

async function buildCloseGuard(electron) {
	const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
																														entryPoints: ['./src/project-save-close-guard.ts'], bundle: true, platform: 'node', format: 'cjs',
																														external: ['vue'], write: false, define: { __ELECTRON__: String(electron) },
																														plugins: [i18nPlugin, { name: 'close-guard-dialog', setup(build) {
																															build.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'close-guard-dialog' }));
																															build.onLoad({ filter: /.*/, namespace: 'close-guard-dialog' }, () => ({ contents: `
				export function alert(options) { window.saveCloseNotices.push(options); return window.dismissCloseNotice.promise; }
			` }));
																														} }],
	});
	const bundled = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), bundled, bundled.exports);
	return bundled.exports.installProjectSaveCloseGuard;
}

const installBrowserGuard = await buildCloseGuard(false);
const installDesktopGuard = await buildCloseGuard(true);

function fixture(t, install, saving = false, unsaved = false) {
	const previousWindow = globalThis.window;
	const target = new EventTarget();
	target.saveCloseNotices = [];
	target.dismissCloseNotice = Promise.withResolvers();
	target.closeConfirmations = [];
	target.confirmClose = false;
	target.desktop = { confirmProjectClose(labels) { target.closeConfirmations.push(labels); return target.confirmClose; } };
	globalThis.window = target;
	const isProjectSaving = ref(saving);
	const hasUnsavedChanges = ref(unsaved);
	const dispose = install(isProjectSaving, hasUnsavedChanges);
	t.after(() => { dispose(); globalThis.window = previousWindow; });
	return { target, isProjectSaving, hasUnsavedChanges, dispose, close() {
		const event = new Event('beforeunload', { cancelable: true });
		// NodeのEvent.returnValueはDOMのBeforeUnloadEventとは別のプロパティなので置き換える。
		Object.defineProperty(event, 'returnValue', { value: '', writable: true });
		target.dispatchEvent(event);
		return event;
	} };
}

// 【Web版は保存中だけ標準の終了確認を要求し、保存完了・破棄では解除する】
// 手動保存の直後のcloseに間に合うよう、次のVue更新を待たずに保護する必要がある。
// 保存前後の通常終了に警告が出続けたり、Web版で独自ダイアログを併用したりしない。
test('requests browser confirmation synchronously only while saving and cleans up on disposal', t => {
	const fixtureState = fixture(t, installBrowserGuard);
	fixtureState.hasUnsavedChanges.value = true;
	assert.equal(fixtureState.close().defaultPrevented, false);
	fixtureState.isProjectSaving.value = true;
	const blocked = fixtureState.close();
	assert.equal(blocked.defaultPrevented, true);
	assert.equal(blocked.returnValue, true);
	assert.deepEqual(fixtureState.target.saveCloseNotices, []);
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

// 【Electron版は終了を取り消して理由を表示し、連続する終了要求で通知を重ねない】
// 標準の終了確認が出ないElectronでは、操作が無反応に見えないよう案内する。
// 表示中にも終了防止は続けるが、保存完了後の再操作は妨げない。
test('cancels desktop closing and shows one notice until it is dismissed', async t => {
	const fixtureState = fixture(t, installDesktopGuard, true, true);
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.deepEqual(fixtureState.target.saveCloseNotices, [{ type: 'info', title: i18n.ts._App.ProjectSaving, text: i18n.ts._App.CannotCloseWhileSaving }]);
	fixtureState.target.dismissCloseNotice.resolve();
	await Promise.resolve();
	assert.equal(fixtureState.close().defaultPrevented, true);
	assert.equal(fixtureState.target.saveCloseNotices.length, 2);
	assert.deepEqual(fixtureState.target.closeConfirmations, []);
	fixtureState.hasUnsavedChanges.value = false;
	fixtureState.isProjectSaving.value = false;
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【Electron版は未保存の変更を確認し、キャンセル後も次の終了要求を保護する】
// 一度の確認結果を保持すると、キャンセル後や保存後の再編集で未保存の変更を失う。
// 保存済み・初回未保存・保存後の再編集を同じ現在状態の判定で扱う。
test('confirms unsaved desktop changes for each unload and permits only explicit approval', t => {
	const fixtureState = fixture(t, installDesktopGuard);
	assert.equal(fixtureState.close().defaultPrevented, false);
	assert.equal(fixtureState.target.closeConfirmations.length, 0);
	fixtureState.hasUnsavedChanges.value = true;
	const canceled = fixtureState.close();
	assert.equal(canceled.defaultPrevented, true);
	assert.equal(canceled.returnValue, true);
	assert.deepEqual(fixtureState.target.closeConfirmations, [{
		message: i18n.ts._App.ConfirmCloseUnsavedProject,
		detail: i18n.ts._App.UnsavedChangesWillBeLost,
		closeButtonLabel: i18n.ts._App.CloseWithoutSaving,
		cancelButtonLabel: i18n.ts.Cancel,
	}]);
	fixtureState.target.confirmClose = true;
	assert.equal(fixtureState.close().defaultPrevented, false);
	assert.equal(fixtureState.target.closeConfirmations.length, 2);
	fixtureState.hasUnsavedChanges.value = false;
	assert.equal(fixtureState.close().defaultPrevented, false);
	assert.equal(fixtureState.target.closeConfirmations.length, 2);
	fixtureState.hasUnsavedChanges.value = true;
	fixtureState.target.confirmClose = false;
	assert.equal(fixtureState.close().defaultPrevented, true);
	fixtureState.dispose();
	assert.equal(fixtureState.close().defaultPrevented, false);
});

// 【Electronの確認APIがない場合は未保存のまま終了させない】
// preloadの初期化に問題があっても、確認を省略してデータを失わないようにする。
test('blocks unsaved desktop closing when the desktop bridge is unavailable', t => {
	const fixtureState = fixture(t, installDesktopGuard, false, true);
	fixtureState.target.desktop = null;
	assert.equal(fixtureState.close().defaultPrevented, true);
});
