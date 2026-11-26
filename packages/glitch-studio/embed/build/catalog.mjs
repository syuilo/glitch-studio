import { build } from 'esbuild';
import { compactWgsl, wgslShaderEsbuildPlugin } from '@gs/shared/build/wgsl-shader.mjs';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** 開発時にTS・WGSL・npm依存を解決しておき、製品には再バンドル可能なESMを配布する。 */
export async function buildPortableNodesEffectCatalog(outdir) {
	const root = fileURLToPath(new URL('../', import.meta.url));
	const createEffectInstance = fileURLToPath(import.meta.resolve('@gs/subsystems_effect_renderer/create-effect-instance.ts'));
	const effectsRoot = path.dirname(fileURLToPath(import.meta.resolve('@gs/subsystems_effect_native-effects/definitions.ts')));
	const effectIds = [];
	for (const entry of await readdir(path.join(effectsRoot, 'fx'), { withFileTypes: true })) {
		if (entry.isDirectory() && (await readdir(path.join(effectsRoot, 'fx', entry.name))).includes('_def_.ts')) effectIds.push(entry.name);
	}
	effectIds.sort();
	const entryPoints = {
		element: path.join(root, 'src/element.ts'), worker: path.join(root, 'src/worker.ts'),
		expression: fileURLToPath(import.meta.resolve('@gs/shared/expression/expression-evaluator.ts')),
		'custom-shader-effects': createEffectInstance,
		'native-effect-instance': 'portable:native-effect-instance',
	};
	for (const id of effectIds) {
		entryPoints[`effects/${id}/definition`] = fileURLToPath(import.meta.resolve(`@gs/subsystems_effect_native-effects/fx/${id}/_def_.ts`));
		entryPoints[`effects/${id}/implementation`] = fileURLToPath(import.meta.resolve(`@gs/subsystems_effect_native-effects/fx/${id}/_impl_.ts`));
	}
	await mkdir(outdir, { recursive: true });
	const result = await build({
		absWorkingDir: root, entryPoints, outdir, bundle: true, splitting: true, format: 'esm', platform: 'browser',
		target: 'esnext', charset: 'ascii', legalComments: 'inline', metafile: true,
		// Workerは通常描画だけを使う。分割したES Modulesの生成前にタイル描画とGPU計測の分岐を落とす。
		define: { USE_TILE_RENDERING: 'false' }, minifySyntax: true,
		// エフェクト内蔵画像もカタログへ埋め込み、選択された実装と一緒に成果物へ渡す。
		// UIのpublic配信や、最終出力とは別の画像ファイルを必要としない。
		loader: { '.png': 'dataurl' },
		plugins: [wgslShaderEsbuildPlugin({ compact: true }), { name: 'portable-runtime-sources', setup(builder) {
			// effectの通常の静的importをカタログのprivate importにする。最終ビルド時の
			// package条件で実装を選ぶため、式を使わない作品にAiScriptの初期化も残らない。
			builder.onResolve({ filter: /^@gs\/shared\/expression\/expression-evaluator\.ts$/ }, () => ({ path: '#expression', external: true }));
			builder.onResolve({ filter: /^@gs\/subsystems_effect_renderer\/create-effect-instance\.ts$/ }, () => ({ path: '#effect-instance', external: true }));
			// 公開入口のNative専用版を作る。その他の依存は通常版と同じESMチャンクを共有する。
			builder.onResolve({ filter: /^portable:native-effect-instance$/ }, () => ({ path: createEffectInstance, namespace: 'portable-native-only' }));
			builder.onLoad({ filter: /.*/, namespace: 'portable-native-only' }, async args => ({
				contents: await readFile(args.path, 'utf8'), resolveDir: path.dirname(args.path), loader: 'ts',
			}));
			builder.onResolve({ filter: /^\.\/custom-shader-effect\.ts$/, namespace: 'portable-native-only' }, () => ({ path: '#unused-features', external: true }));
			builder.onResolve({ filter: /subsystems_effect_native-effects\/(definitions|implementations)\.[jt]s$/ }, args => {
				if (args.kind === 'entry-point') return null;
				throw new Error('Portable runtime must receive selected effects explicitly');
			});
			builder.onResolve({ filter: /\?raw$/ }, async args => {
				const resolved = await builder.resolve(args.path.slice(0, -4), { resolveDir: args.resolveDir, kind: args.kind });
				return { path: resolved.path, namespace: 'portable-raw-source', errors: resolved.errors };
			});
			builder.onLoad({ filter: /.*/, namespace: 'portable-raw-source' }, async args => {
				const source = await readFile(args.path, 'utf8');
				return { contents: args.path.endsWith('.wgsl') ? compactWgsl(source) : source, loader: 'text' };
			});
		} }],
	});
	await writeFile(path.join(outdir, 'manifest.json'), JSON.stringify({ effectIds }));
	// ASAR外でもESMとして解決でき、カタログ単独で配布・検証できるようにする。
	await writeFile(path.join(outdir, 'unused-features.js'), `export class ExpressionEvaluator {
		evaluate() { throw new Error('Expressions are unavailable in this artwork'); }
	}
	export function initCustomShaderEffect() { throw new Error('Custom Shader Effects are unavailable in this artwork'); }
	`);
	await writeFile(path.join(outdir, 'package.json'), JSON.stringify({ type: 'module', imports: {
		'#expression': { 'portable-expressions': './expression.js', default: './unused-features.js' },
		'#effect-instance': { 'portable-custom-shaders': './custom-shader-effects.js', default: './native-effect-instance.js' },
		'#unused-features': './unused-features.js',
	} }));
	return result.metafile;
}
