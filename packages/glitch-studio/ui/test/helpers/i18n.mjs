import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';

// 操作・SFCのテストでは言語選択やlocalStorageを起動せず、実際の翻訳クラスと英語辞書を使う。
// ブラウザー固有の初期化より前を取り出すことで、補間処理のモック実装や辞書の複製を避ける。
const source = await readFile(new URL('../../src/i18n.ts', import.meta.url), 'utf8');
const locale = JSON.parse(await readFile(new URL('../../locales/en-US.json', import.meta.url), 'utf8'));
const contents = `${source.slice(0, source.indexOf('export const isLocaleUnconfigured'))}
export const i18n = new I18n(${JSON.stringify(locale)});
export const lang = 'en-US';
export const isLocaleUnconfigured = false;`;
const { code } = await transform(contents, { loader: 'ts', format: 'cjs' });
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(createRequire(import.meta.url), module, module.exports);
export const { i18n } = module.exports;

export const i18nPlugin = {
	name: 'test-i18n',
	setup(build) {
		build.onResolve({ filter: /(?:^|\/)locale-settings-ui\.[jt]s$/ }, () => ({ path: 'locale-settings-ui', namespace: 'test-locale-settings-ui' }));
		build.onLoad({ filter: /.*/, namespace: 'test-locale-settings-ui' }, () => ({ contents: 'export async function configureLocale() {} export async function changeLocale() {}' }));
		build.onResolve({ filter: /(?:^|\/)i18n\.[jt]s$/ }, () => ({ path: 'i18n', namespace: 'test-i18n' }));
		build.onLoad({ filter: /.*/, namespace: 'test-i18n' }, () => ({ loader: 'ts', contents }));
	},
};
