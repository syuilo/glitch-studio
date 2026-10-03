import { build } from 'esbuild';
import { createRequire } from 'node:module';

// パッケージ間の.js参照もTypeScriptソースへ解決し、アプリと同じモジュール構成で検証する。
export async function loadSource(entry) {
	const bundled = await build({
		entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false,
	});
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
