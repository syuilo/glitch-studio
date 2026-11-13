import { build } from 'esbuild';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 開発時にTS・WGSL・npm依存を解決しておき、製品には再バンドル可能なESMを配布する。 */
export async function buildPortableVisualModuleCatalog(outdir) {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const effectsRoot = path.dirname(fileURLToPath(import.meta.resolve('@gs/subsystems_effect_shared/effect-definitions.ts')));
	const effectIds = [];
	for (const entry of await readdir(path.join(effectsRoot, 'fx'), { withFileTypes: true })) {
		if (entry.isDirectory() && (await readdir(path.join(effectsRoot, 'fx', entry.name))).includes('_def_.ts')) effectIds.push(entry.name);
	}
	effectIds.sort();
	const entryPoints = {
		element: path.join(root, 'src/element.ts'), worker: path.join(root, 'src/worker.ts'),
		expression: fileURLToPath(import.meta.resolve('@gs/shared/expression/expression-evaluator.ts')),
		'custom-shader-effects': fileURLToPath(import.meta.resolve('@gs/glitch-studio_renderer/custom-shader-effects.ts')),
	};
	for (const id of effectIds) {
		entryPoints[`effects/${id}/definition`] = fileURLToPath(import.meta.resolve(`@gs/subsystems_effect_shared/fx/${id}/_def_.ts`));
		entryPoints[`effects/${id}/implementation`] = fileURLToPath(import.meta.resolve(`@gs/subsystems_effect_shared/fx/${id}/_impl_.ts`));
	}
	await mkdir(outdir, { recursive: true });
	const result = await build({
		absWorkingDir: root, entryPoints, outdir, bundle: true, splitting: true, format: 'esm', platform: 'browser',
		target: 'esnext', charset: 'ascii', legalComments: 'inline', metafile: true,
		// エフェクト内蔵画像もカタログへ埋め込み、選択された実装と一緒に成果物へ渡す。
		// UIのpublic配信や、最終出力とは別の画像ファイルを必要としない。
		loader: { '.png': 'dataurl' },
		plugins: [{ name: 'portable-runtime-sources', setup(builder) {
			builder.onResolve({ filter: /effect-(definitions|implementations)\.[jt]s$/ }, () => {
				throw new Error('Portable runtime must receive selected effects explicitly');
			});
			builder.onResolve({ filter: /\?raw$/ }, async args => {
				const resolved = await builder.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
				return { path: resolved.path, namespace: 'portable-raw-source', errors: resolved.errors };
			});
			builder.onLoad({ filter: /.*/, namespace: 'portable-raw-source' }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
		} }],
	});
	await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({ effectIds }));
	// ASAR外でもESMとして解決でき、カタログ単独で配布・検証できるようにする。
	await writeFile(path.join(outdir, 'package.json'), JSON.stringify({ type: 'module' }));
	return result.metafile;
}
