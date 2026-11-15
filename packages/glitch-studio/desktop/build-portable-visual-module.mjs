import { build } from 'esbuild';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { buildPortableVisualModuleCatalog } from '@gs/glitch-studio_embed/build/catalog.mjs';

export async function buildDesktopPortableVisualModule(outputDirectory = path.join(import.meta.dirname, 'dist')) {
	const outputRoot = path.resolve(outputDirectory);
	const catalogDirectory = path.join(outputRoot, 'portable-visual-module-catalog');
	// ハッシュ名の古いchunkを製品へ蓄積しない。削除対象は出力先の専用ディレクトリに限定する。
	if (path.dirname(catalogDirectory) !== outputRoot) throw new Error('Invalid portable runtime output directory');
	await rm(catalogDirectory, { recursive: true, force: true });
	await buildPortableVisualModuleCatalog(catalogDirectory);
	await build({
		entryPoints: [path.join(import.meta.dirname, 'portable-visual-module-worker.mjs')],
		outfile: path.join(outputDirectory, 'portable-visual-module-worker.mjs'),
		bundle: true, platform: 'node', format: 'esm', target: 'esnext', external: ['esbuild'],
	});
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename) await buildDesktopPortableVisualModule();
