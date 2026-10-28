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
const options = { absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false };
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

// 【環境設定の適用では、編集したバックアップのフィールドだけを保存する】
// 古い画面で間隔だけを変えても、別の画面で無効化した設定まで元に戻してはならない。
// 保存キーを細分化しただけでは、適用時に全フィールドを書き戻す実装を防げない。
// ブラウザー版のキャッシュ容量も表示・検証・保存でき、未編集時には書き戻さないことを確認する。
// 先行フレーム数も環境設定だけへ保存し、0や上限3を使えて不正値を適用しないことを確認する。
test('applies only edited settings and validates timeline preview preferences', async t => {
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
	// 別の画面による保存を再現する。適用時には未編集の言語も保存しない。
	storage.set('preferences:projectBackupAutoEnabled', 'false');
	storage.set('preferences:projectBackupSaveRetentionDays', '30');
	storage.set('locale', 'en-US');
	find('data-test-backup-auto-interval').props['onUpdate:modelValue'](5);
	await nextTick();
	await find('data-test-settings-apply').props.onClick();
	assert.deepEqual(writes, ['preferences:projectBackupAutoIntervalMinutes']);
	assert.equal(storage.get('preferences:projectBackupAutoEnabled'), 'false');
	assert.equal(storage.get('preferences:projectBackupAutoIntervalMinutes'), '5');
	assert.equal(storage.get('preferences:projectBackupSaveRetentionDays'), '30');
	assert.equal(preferences.s.projectBackupAutoEnabled, true);
	assert.equal(storage.get('locale'), 'en-US');
	assert.deepEqual(window.settingsTestLocaleChanges, []);
	const capacity = find('data-test-timeline-frame-cache-capacity');
	assert.equal(capacity.props.modelValue, 2);
	capacity.props['onUpdate:modelValue'](-1);
	await nextTick();
	assert.equal(find('data-test-settings-apply').props.disabled, true);
	await find('data-test-settings-apply').props.onClick();
	assert.deepEqual(writes, ['preferences:projectBackupAutoIntervalMinutes']);
	capacity.props['onUpdate:modelValue'](1);
	await nextTick();
	assert.equal(find('data-test-settings-apply').props.disabled, false);
	await find('data-test-settings-apply').props.onClick();
	assert.equal(preferences.s.timelineFrameCacheMaxGiB, 1);
	assert.equal(storage.get('preferences:timelineFrameCacheMaxGiB'), '1');
	// 【先行フレーム数を0〜3の整数に限定し、0でも設定を適用する】
	// 空欄や小数などを保存するとスケジューラーを作れなくなるため、適用前に拒否する。
	const framesAhead = find('data-test-timeline-preview-frames-ahead');
	assert.equal(framesAhead.props.modelValue, 1);
	assert.equal(framesAhead.props.min, 0);
	assert.equal(framesAhead.props.max, 3);
	assert.equal(framesAhead.props.step, 1);
	const writeCount = writes.length;
	for (const value of [-1, 0.5, 4, NaN, Infinity]) {
		framesAhead.props['onUpdate:modelValue'](value);
		await nextTick();
		assert.equal(find('data-test-settings-apply').props.disabled, true);
		await find('data-test-settings-apply').props.onClick();
		assert.equal(writes.length, writeCount);
	}
	for (const value of [0, 3]) {
		framesAhead.props['onUpdate:modelValue'](value);
		await nextTick();
		assert.equal(find('data-test-settings-apply').props.disabled, false);
		await find('data-test-settings-apply').props.onClick();
		assert.equal(preferences.s.timelinePreviewFramesAhead, value);
		assert.equal(storage.get('preferences:timelinePreviewFramesAhead'), JSON.stringify(value));
	}
});
