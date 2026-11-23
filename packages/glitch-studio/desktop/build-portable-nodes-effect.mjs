import { build } from 'esbuild';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { buildPortableNodesEffectCatalog } from '@gs/glitch-studio_embed/build/catalog.mjs';

export async function buildDesktopPortableNodesEffect(outputDirectory = path.join(import.meta.dirname, 'dist')) {
	const outputRoot = path.resolve(outputDirectory);
	const catalogDirectory = path.join(outputRoot, 'portable-nodes-effect-catalog');
	// ハッシュ名の古いchunkを製品へ蓄積しない。削除対象は出力先の専用ディレクトリに限定する。
	if (path.dirname(catalogDirectory) !== outputRoot) throw new Error('Invalid portable runtime output directory');
	await rm(catalogDirectory, { recursive: true, force: true });
	await buildPortableNodesEffectCatalog(catalogDirectory);
	await build({
		entryPoints: [path.join(import.meta.dirname, 'portable-nodes-effect-worker.mjs')],
		outfile: path.join(outputDirectory, 'portable-nodes-effect-worker.mjs'),
		bundle: true, platform: 'node', format: 'esm', target: 'esnext', external: ['esbuild'],
	});
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === import.meta.filename) await buildDesktopPortableNodesEffect();
