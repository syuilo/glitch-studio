import { build } from 'esbuild';
import { createRequire } from 'node:module';

export async function bundleSource(entry, platform = 'node') {
	return build({
		entryPoints: [entry], bundle: true, platform, format: platform === 'node' ? 'cjs' : 'esm', write: false,
		loader: { '.wgsl': 'text' },
	});
}
export async function loadShaderSource(entry) {
	const result = await bundleSource(entry);
	const module = { exports: {} };
	new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
	return module.exports;
}
