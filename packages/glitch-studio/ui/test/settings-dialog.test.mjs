import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'node:path';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h, nextTick } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
// Viteを通さないテストでも、ブラウザー版のビルド時定数を設定する。
const options = { absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false, define: { __ELECTRON__: 'false' } };
const preferenceBundle = await build({ ...options, entryPoints: ['./src/preferences.ts'] });
const dialogBundle = await build({ ...options, entryPoints: ['./src/components/GsSettingsDialog.vue'], plugins: [{
	name: 'settings-dialog-platform', setup(builder) {
		builder.onResolve({ filter: /(?:^|\/)(preferences|locale-settings-ui)\.ts$/ }, ({ path }) => ({ path: basename(path), namespace: 'settings-platform' }));
		builder.onLoad({ filter: /.*/, namespace: 'settings-platform' }, ({ path }) => ({ contents: path === 'preferences.ts' ? 'export const preferences = window.settingsTestPreferences;'
			: 'export async function changeLocale(locale) { window.settingsTestLocaleChanges.push(locale); }' }));
		builder.onResolve({ filter: /\.vue$/ }, ({ path }) => path.endsWith('GsSettingsDialog.vue') ? null : { path: basename(path, '.vue'), namespace: 'settings-control' });
		builder.onLoad({ filter: /.*/, namespace: 'settings-control' }, () => ({ contents: `
			import { h } from 'vue';
			export default { setup(_, { attrs, slots, expose }) {
				expose({ close() {} }); return () => h('div', attrs, slots.default?.());
			} };
		` }));
		builder.onLoad({ filter: /GsSettingsDialog\.vue$/ }, async ({ path }) => {
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

// 【環境設定では、個別に確定した項目だけを保存する】
// 古い画面で間隔だけを変えても、別の画面で無効化した設定まで元に戻してはならない。
// ブラウザー版のキャッシュ容量も表示・保存でき、未編集時には書き戻さないことを確認する。
// 先行フレーム数も環境設定だけへ保存し、0も保存できることを確認する。
test('saves settings individually', async t => {
	const previousWindow = globalThis.window;
	const storage = new Map([['preferences:projectBackupAutoEnabled', 'true'], ['locale', 'ja-JP']]);
	const writes = [];
	globalThis.window = { localStorage: { getItem: key => storage.get(key) ?? null,
																																							setItem(key, value) { storage.set(key, value); writes.push(key); } }, settingsTestLocaleChanges: [] };
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
	t.after(() => { app.unmount(); globalThis.window = previousWindow; });
	app.mount(root);

	function find(attribute, node = root) {
		if (Object.hasOwn(node.props, attribute)) return node;
		for (const child of node.children) { const found = find(attribute, child); if (found != null) return found; }
		return null;
	}

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
	const displayMode = find('data-test-preview-display-mode');
	assert.equal(displayMode.props.modelValue, 'cpu');
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
