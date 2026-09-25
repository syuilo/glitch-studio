import { build } from 'esbuild';
import { createRequire } from 'node:module';

export async function bundleSource(entry, platform = 'node') {
	return build({
		entryPoints: [entry], bundle: true, platform, format: platform === 'node' ? 'cjs' : 'esm', write: false,
		loader: { '.wgsl': 'text' },
		// レンダラーのテストは必要な定義を個別に読み込み、コンストラクターへ渡す。
		// モジュール入力の出力定義を調べる際に間接参照される、Vite専用の一覧は読み込まない。
		plugins: [{ name: 'shader-source-test', setup(build) {
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'shader-source-test' }));
			build.onLoad({ filter: /.*/, namespace: 'shader-source-test' }, () => ({
				contents: 'export const effectDefinitions = {};', loader: 'ts',
			}));
		} }],
	});
}
export async function loadShaderSource(entry) {
	const result = await bundleSource(entry);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
