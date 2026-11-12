import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';
import { i18n, i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
// Viteを通さないテストでも、ブラウザー版のビルド時定数を設定する。
const options = { absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false, define: { __ELECTRON__: 'false' } };
const preferenceBundle = await build({ ...options, entryPoints: ['./src/preferences.ts'] });
const dialogBundle = await build({ ...options, entryPoints: ['./src/components/GsSettingsDialog.vue'], plugins: [{
	name: 'settings-dialog-platform', setup(builder) {
		builder.onResolve({ filter: /(?:^|\/)(preferences|locale-settings-ui)\.ts$/ }, ({ path }) => ({ path: basename(path), namespace: 'settings-platform' }));
		builder.onLoad({ filter: /.*/, namespace: 'settings-platform' }, ({ path }) => ({ contents: path === 'preferences.ts' ? 'export const preferences = window.settingsTestPreferences;'
			: 'export async function changeLocale(locale) { window.settingsTestLocaleChanges.push(locale); }' }));
		builder.onResolve({ filter: /(?:^|\/)ui\.ts$/ }, () => ({ path: 'ui', namespace: 'settings-dialog-ui' }));
		builder.onLoad({ filter: /.*/, namespace: 'settings-dialog-ui' }, () => ({ contents: `
			export const confirm = options => window.settingsTestUi.confirm(options);
			export const alert = options => window.settingsTestUi.alert(options);
		` }));
		builder.onResolve({ filter: /\.vue$/ }, ({ path }) => /Gs(?:SettingsDialog|EffectRenderTilingSettings)\.vue$/.test(path) ? null : { path: basename(path, '.vue'), namespace: 'settings-control' });
		builder.onLoad({ filter: /.*/, namespace: 'settings-control' }, () => ({ contents: `
			import { h } from 'vue';
			export default { setup(_, { attrs, slots, expose }) {
				expose({ close() {} }); return () => h('div', attrs, slots.default?.());
			} };
		` }));
		builder.onLoad({ filter: /Gs(?:SettingsDialog|EffectRenderTilingSettings)\.vue$/ }, async ({ path }) => {
			const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor;
			const script = compileScript(descriptor, { id: 'settings-test', inlineTemplate: true, genDefaultAs: 'component' }).content;
			return { loader: 'ts', resolveDir: dirname(path), contents: `${script}; component.__cssModules = { $style: {} }; export default component;` };
		});
	},
}, i18nPlugin] });

function evaluate(bundle) {
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}

function mountSettingsDialog(t) {
	const previousWindow = globalThis.window;
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	const storage = new Map([['preferences:projectBackupAutoEnabled', 'true'], ['locale', 'ja-JP']]);
	const writes = [];
	globalThis.window = {
		localStorage: {
			getItem: key => storage.get(key) ?? null,
			setItem(key, value) { storage.set(key, value); writes.push(key); },
			removeItem: key => storage.delete(key),
		},
		settingsTestLocaleChanges: [],
		settingsTestUi: {},
	};
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage });
	const { preferences } = evaluate(preferenceBundle);
	window.settingsTestPreferences = preferences;
	const component = evaluate(dialogBundle).default;
	const element = tag => ({ tag, children: [], parent: null, props: {} });
	const renderer = createRenderer({ createElement: element, createText: () => element('text'), createComment: () => element('comment'),
																																			setText() {}, setElementText() {}, patchProp(node, key, _old, value) { node.props[key] = value; },
																																			insert(node, parent, anchor = null) { parent.children.splice(anchor == null ? parent.children.length : parent.children.indexOf(anchor), 0, node); node.parent = parent; },
																																			remove(node) { node.parent.children.splice(node.parent.children.indexOf(node), 1); },
																																			parentNode: node => node.parent, nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
	});
	const root = element('root');
	const app = renderer.createApp({ render: () => h(component) });
	t.after(() => {
		app.unmount();
		globalThis.window = previousWindow;
		if (previousStorage == null) delete globalThis.localStorage;
		else Object.defineProperty(globalThis, 'localStorage', previousStorage);
	});
	app.mount(root);

	function find(attribute, node = root) {
		if (Object.hasOwn(node.props, attribute)) return node;
		for (const child of node.children) { const found = find(attribute, child); if (found != null) return found; }
		return null;
	}

	return { find, preferences, storage, writes };
}

// 【リセットは確認でOKを選んだ場合だけ行い、完了後に再起動を案内する】
// 確認待ちやキャンセルで設定を失わず、言語と各設定の表示もリセット結果へ揃える。
// 言語の表示値を戻すだけで言語変更用のダイアログが重複して開かないことも確認する。
test('resets preferences only after confirmation and shows the restart notice', async t => {
	const { find, preferences, storage } = mountSettingsDialog(t);
	preferences.commit('previewVolume', 0.1);
	preferences.commit('timelineFrameCacheMaxGiB', 0);
	storage.set('recent-projects', 'keep');
	const initialStorage = new Map(storage);
	const dialogs = [];
	let resolveConfirmation = null;
	window.settingsTestUi = {
		confirm(options) {
			dialogs.push({ kind: 'confirm', options });
			return new Promise(resolve => { resolveConfirmation = resolve; });
		},
		async alert(options) { dialogs.push({ kind: 'alert', options }); },
	};
	const resetButton = find('data-test-reset-preferences');
	assert.equal(Object.hasOwn(resetButton.props, 'danger'), true);

	const canceledReset = resetButton.props.onClick();
	await nextTick();
	assert.deepEqual(storage, initialStorage);
	assert.equal(dialogs.length, 1);
	assert.equal(dialogs[0].options.text, i18n.ts._Settings.ConfirmReset);
	resolveConfirmation({ canceled: true });
	await canceledReset;
	assert.deepEqual(storage, initialStorage);
	assert.equal(preferences.s.previewVolume, 0.1);
	assert.equal(dialogs.length, 1);

	const confirmedReset = resetButton.props.onClick();
	resolveConfirmation({ canceled: false });
	await confirmedReset;
	await nextTick();
	assert.deepEqual([...storage], [['recent-projects', 'keep']]);
	assert.equal(preferences.s.previewVolume, 0.5);
	assert.equal(preferences.s.projectBackupAutoEnabled, false);
	assert.equal(find('data-test-timeline-frame-cache-capacity').props.modelValue, 2);
	assert.equal(find('data-test-language').props.modelValue, 'en-US');
	assert.deepEqual(window.settingsTestLocaleChanges, []);
	assert.deepEqual(dialogs.map(dialog => dialog.kind), ['confirm', 'confirm', 'alert']);
	assert.deepEqual(dialogs[2].options, { type: 'success', text: i18n.ts._Settings.ResetComplete });
});

// 【環境設定では、個別に確定した項目だけを保存する】
// 古い画面で間隔だけを変えても、別の画面で無効化した設定まで元に戻してはならない。
// ブラウザー版のキャッシュ容量も表示・保存でき、未編集時には書き戻さないことを確認する。
// 先行フレーム数も環境設定だけへ保存し、0も保存できることを確認する。
test('saves settings individually', async t => {
	const { find, preferences, storage, writes } = mountSettingsDialog(t);

	// 言語だけはダイアログを開くときの保存値を使い、表示中の辞書とは独立した選択値を示す。
	assert.equal(find('data-test-language').props.modelValue, 'ja-JP');
	// 別の画面による保存を再現する。未編集の項目は保存しない。
	storage.set('preferences:projectBackupAutoEnabled', 'false');
	storage.set('preferences:projectBackupSaveRetentionDays', '30');
	storage.set('locale', 'en-US');
	find('data-test-backup-auto-interval').props['onUpdate:modelValue'](5);
	await nextTick();
	assert.deepEqual(writes, ['preferences:projectBackupAutoIntervalMinutes']);
	assert.equal(storage.get('preferences:projectBackupAutoEnabled'), 'false');
	assert.equal(storage.get('preferences:projectBackupAutoIntervalMinutes'), '5');
	assert.equal(storage.get('preferences:projectBackupSaveRetentionDays'), '30');
	assert.equal(preferences.s.projectBackupAutoEnabled, true);
	assert.equal(storage.get('locale'), 'en-US');
	assert.deepEqual(window.settingsTestLocaleChanges, []);
	const capacity = find('data-test-timeline-frame-cache-capacity');
	assert.equal(capacity.props.modelValue, 2);
	assert.equal(Object.hasOwn(capacity.props, 'manualSave'), true);
	assert.equal(Object.hasOwn(find('data-test-backup-auto-interval').props, 'manualSave'), true);
	capacity.props['onUpdate:modelValue'](1);
	await nextTick();
	assert.equal(preferences.s.timelineFrameCacheMaxGiB, 1);
	assert.equal(storage.get('preferences:timelineFrameCacheMaxGiB'), '1');
	// 【保存精度は元の精度を既定とし、8bitとの切替を環境設定へ保存する】
	// 表示用モデルだけが変わる実装を防ぎ、次回のWorker生成にも同じ選択値を渡せるようにする。
	const precision = find('data-test-timeline-frame-cache-precision');
	assert.equal(precision.props.modelValue, 'original');
	assert.deepEqual(precision.props.items.map(item => item.value), ['original', '8bit']);
	assert.equal(storage.has('preferences:timelineFrameCachePrecision'), false);
	for (const value of ['8bit', 'original']) {
		precision.props['onUpdate:modelValue'](value);
		await nextTick();
		assert.equal(preferences.s.timelineFrameCachePrecision, value);
		assert.equal(storage.get('preferences:timelineFrameCachePrecision'), JSON.stringify(value));
	}
	// 【先行フレーム数を0・1・2・3から選択し、即時保存する】
	// 自由入力を使わず、先行レンダリングを無効にする0も含めて選択・保存できるようにする。
	const framesAhead = find('data-test-timeline-preview-frames-ahead');
	assert.equal(Object.hasOwn(framesAhead.props, 'manualSave'), false);
	assert.equal(framesAhead.props.modelValue, 1);
	assert.deepEqual(framesAhead.props.items, [0, 1, 2, 3].map(value => ({ value, label: String(value) })));
	for (const value of [0, 1, 2, 3]) {
		framesAhead.props['onUpdate:modelValue'](value);
		await nextTick();
		assert.equal(preferences.s.timelinePreviewFramesAhead, value);
		assert.equal(storage.get('preferences:timelinePreviewFramesAhead'), JSON.stringify(value));
	}
	// 【表示方式を設定から保存し、GPUとCPUを相互に切り替える】
	// 設定画面を開いただけでは既定値を書き込まず、選択した方式を次回起動にも保持する。
	// 【自動を初期値とし、手動のタイル寸法と無効の選択を保存する】
	// 画面を開いただけでは書き戻さず、最大寸法を変更した結果をWorkerへ渡せる設定として保持する。
	const tilingMode = find('data-test-effect-render-tiling-mode');
	assert.equal(tilingMode.props.modelValue, 'auto');
	assert.deepEqual(tilingMode.props.items.map(item => item.value), ['auto', 'disabled', 'manual']);
	assert.equal(storage.has('preferences:effectRenderTiling'), false);
	tilingMode.props['onUpdate:modelValue']('manual');
	await nextTick();
	const tileSize = find('data-test-effect-render-tile-size');
	assert.equal(tileSize.props.modelValue, 512);
	tileSize.props['onUpdate:modelValue'](128);
	await nextTick();
	assert.deepEqual(preferences.s.effectRenderTiling, { mode: 'manual', tileSize: 128 });
	assert.equal(storage.get('preferences:effectRenderTiling'), JSON.stringify({ mode: 'manual', tileSize: 128 }));
	for (const mode of ['disabled', 'auto']) {
		tilingMode.props['onUpdate:modelValue'](mode);
		await nextTick();
		assert.deepEqual(preferences.s.effectRenderTiling, { mode });
	}
	tilingMode.props['onUpdate:modelValue']('manual');
	await nextTick();
	assert.equal(find('data-test-effect-render-tile-size').props.modelValue, 128);
	const displayMode = find('data-test-preview-display-mode');
	assert.equal(displayMode.props.modelValue, 'gpu');
	assert.equal(storage.has('preferences:previewDisplayMode'), false);
	// 既定のGPUから別の方式へ変更してから戻し、両方向の変更で保存されることを確認する。
	for (const value of ['cpu', 'gpu']) {
		displayMode.props['onUpdate:modelValue'](value);
		await nextTick();
		assert.equal(preferences.s.previewDisplayMode, value);
		assert.equal(storage.get('preferences:previewDisplayMode'), JSON.stringify(value));
	}
	// 【数値とスイッチを個別に保存する】
	// 数値の確定操作とスイッチの即時保存が、全体の適用操作を必要としないことを確認する。
	find('data-test-backup-auto-interval').props['onUpdate:modelValue'](10);
	find('data-test-visual-module-auto-connect-on-node-add').props['onUpdate:modelValue'](true);
	await nextTick();
	assert.equal(preferences.s.timelineFrameCacheMaxGiB, 1);
	assert.equal(preferences.s.projectBackupAutoIntervalMinutes, 10);
	assert.equal(preferences.s.visualModuleAutoConnectOnNodeAdd, true);
	assert.equal(find('data-test-settings-apply'), null);
	// 【言語は選択した時点で保存する】
	// ダイアログ全体の適用操作を不要にし、初期表示だけでは保存しない。
	find('data-test-language').props['onUpdate:modelValue']('en-US');
	await nextTick();
	assert.deepEqual(window.settingsTestLocaleChanges, ['en-US']);
});
