import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

export async function loadEffectNew(relativePath) {
	const result = await build({
		entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
		bundle: true, platform: 'node', format: 'esm', write: false, loader: { '.wgsl': 'text' },
	});
	return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].contents).toString('base64'));
}
