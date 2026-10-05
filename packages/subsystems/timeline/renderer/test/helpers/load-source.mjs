import { build } from 'esbuild';
import { createRequire } from 'node:module';

export async function loadSource(entry) {
	const bundled = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'cjs', write: false, loader: { '.wgsl': 'text' } });
	const module = { exports: {} };
	new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
