import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const locales = Object.fromEntries(await Promise.all(['en-US', 'ja-JP'].map(async language => [language,
	JSON.parse(await readFile(new URL(`../locales/${language}.json`, import.meta.url), 'utf8')),
])));
const bundle = await build({
	entryPoints: [fileURLToPath(new URL('../src/i18n.ts', import.meta.url))],
	bundle: true, platform: 'browser', format: 'esm', write: false,
	define: { 'import.meta.env.DEV': 'true' },
	plugins: [{ name: 'locale-dialog', setup(build) {
		build.onResolve({ filter: /^\.\/ui\.ts$/ }, () => ({ path: 'ui', namespace: 'locale-dialog' }));
		build.onLoad({ filter: /.*/, namespace: 'locale-dialog' }, () => ({ contents: `
			export async function select() { return { canceled: false, result: 'ja-JP' }; }
			export function alert(options) { globalThis.localeTestAlerts.push(options); }
		` }));
	} }],
});
let importGeneration = 0;
async function loadI18n() {
	return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}#${importGeneration++}`);
}

function configureStorage(t, language) {
	const storage = new Map(language == null ? [] : [['locale', language]]);
	const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
		getItem: key => storage.get(key) ?? null,
		setItem: (key, value) => storage.set(key, value),
	} });
	t.after(() => {
		if (previousStorage == null) delete globalThis.localStorage;
		else Object.defineProperty(globalThis, 'localStorage', previousStorage);
	});
	return storage;
}

// 【すべての言語で翻訳キーと補間パラメータを揃える】
// 一方の辞書だけへのキー追加や、翻訳中のパラメータ名の変更は、実行時の表示欠落につながる。
test('keeps locale keys and interpolation parameters aligned', () => {
	function flatten(locale, prefix = '') {
		return Object.fromEntries(Object.entries(locale).flatMap(([key, value]) => typeof value === 'string'
			? [[prefix + key, value]] : Object.entries(flatten(value, `${prefix}${key}.`))));
	}
	const english = flatten(locales['en-US']);
	const japanese = flatten(locales['ja-JP']);
	assert.deepEqual(Object.keys(english).sort(), Object.keys(japanese).sort());
	for (const key of Object.keys(english)) {
		const parameters = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
		assert.notEqual(japanese[key].trim(), '', key);
		assert.deepEqual(parameters(english[key]), parameters(japanese[key]), key);
	}
});

// 【保存された言語でスコープ付き文言と補間文言を初期化する】
// JSONのモジュール自体を辞書として扱ったり、保存と異なるキーを読むと、日本語を選んでも表示できない。
test('loads scoped translations and interpolates text in the saved language', async t => {
	configureStorage(t, 'ja-JP');
	const { i18n, lang } = await loadI18n();
	assert.equal(lang, 'ja-JP');
	assert.equal(i18n.ts._App.File, 'ファイル');
	assert.equal(i18n.tsx._TimelineKeyframe.SelectedCount({ count: 3 }), '3個のキーフレームを選択中');
	assert.equal(i18n.tsx._Export.RenderingFrames({ completed: 2, total: 10, percent: 20 }), '2 / 10フレームをレンダリング中 (20%)');
});

// 【言語選択の保存先と次回起動の読み込み先を一致させる】
// 選択直後の確認だけ翻訳され、再起動で英語へ戻る不具合を防ぐ。
test('preserves the selected language across initialization', async t => {
	const storage = configureStorage(t, 'en-US');
	globalThis.localeTestAlerts = [];
	t.after(() => { delete globalThis.localeTestAlerts; });
	const initial = await loadI18n();
	assert.equal(initial.i18n.ts._App.File, 'File');
	await initial.configureLocale();
	assert.equal(storage.get('locale'), 'ja-JP');
	assert.equal(globalThis.localeTestAlerts[0].title, locales['ja-JP'].LocaleChangedTitle);
	const reloaded = await loadI18n();
	assert.equal(reloaded.i18n.ts._App.File, 'ファイル');
});
