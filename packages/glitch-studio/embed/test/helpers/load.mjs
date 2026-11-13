import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../../', import.meta.url));
const result = await build({
	absWorkingDir: directory, stdin: { resolveDir: directory, loader: 'ts', contents: `
		export * from './src/export.ts'; export * from './src/parameters.ts';
		export * from './src/protocol.ts'; export * from './src/archive.ts';
		export * from './src/frame-rate-limiter.ts';
		export { default as fill } from '@gs/subsystems_effect_shared/fx/fill/_def_.ts';
		export { default as image } from '@gs/subsystems_effect_shared/fx/image/_def_.ts';
		export { default as video } from '@gs/subsystems_effect_shared/fx/video/_def_.ts';
	` },
	bundle: true, write: false, format: 'cjs', platform: 'node',
	plugins: [{ name: 'explicit-test-effects', setup(builder) {
		builder.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test-effects' }));
		builder.onLoad({ filter: /.*/, namespace: 'test-effects' }, () => ({ contents: 'export const effectDefinitions = {};', loader: 'ts' }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
export const implementation = loaded.exports;
