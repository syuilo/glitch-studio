import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { makeShaderDataDefinitions, makeStructuredView } from 'webgpu-utils';
import { compactWgsl, createShaderBufferLayouts, loadWgslShader, wgslShaderEsbuildPlugin, wgslShaderVitePlugin } from '../build/wgsl-shader.mjs';
import { createServer } from 'vite';

const bundled = await build({ entryPoints: [fileURLToPath(new URL('../src/gpu/shader-buffer.ts', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'node' });
const { createShaderBuffer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);

async function temporaryDirectory(t) {
	const root = path.resolve(tmpdir());
	const directory = await mkdtemp(path.join(root, 'glitch-wgsl-shader-'));
	t.after(async () => {
		assert.equal(path.dirname(path.resolve(directory)), root);
		assert.ok(path.basename(directory).startsWith('glitch-wgsl-shader-'));
		await rm(directory, { recursive: true, force: true });
	});
	return directory;
}

// 【事前解析した配置から書き込んでも従来と同じバイト列になる】
// vec3のpadding、整数、行列、配列、入れ子struct、部分更新が崩れると見た目だけでなく
// GPU側の隣接フィールドも破壊するため、ライブラリの従来経路を基準にバッファ全体を比較する。
test('writes identical bytes for nested layouts typed arrays matrices and partial updates', () => {
	const code = `
struct Item { position: vec3f, index: u32, }
struct Settings { gain: f32, offset: vec3f, signedValue: i32, transform: mat3x3f,
  vectors: array<vec3f, 2>, values: array<vec2u, 2>, items: array<Item, 2>, }
@group(0) @binding(0) var<uniform> settings: Settings;
@group(0) @binding(1) var<storage> items: array<Item, 2>;
`;
	const originalDefinitions = makeShaderDataDefinitions(code);
	const layouts = createShaderBufferLayouts(code);
	const updates = [
		{ gain: 0.75, offset: [1, 2, 3], signedValue: -8, transform: [1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0],
			vectors: [[10, 20, 30], [40, 50, 60]], values: new Uint32Array([7, 8, 9, 10]), items: [{ position: [11, 12, 13], index: 14 }, { position: [15, 16, 17], index: 18 }] },
		{ gain: 2, items: [, { index: 99 }] },
	];
	for (const section of ['uniforms', 'structs']) {
		const name = section === 'uniforms' ? 'settings' : 'Settings';
		const expected = makeStructuredView(originalDefinitions[section][name]);
		const actual = createShaderBuffer(layouts[section][name]);
		for (const update of updates) {
			expected.set(update); actual.set(update);
			assert.deepEqual(new Uint8Array(actual.arrayBuffer), new Uint8Array(expected.arrayBuffer));
		}
		assert.notEqual(actual.arrayBuffer, createShaderBuffer(layouts[section][name]).arrayBuffer);
	}
	const storage = createShaderBuffer(layouts.storages.items);
	const expectedStorage = makeStructuredView(originalDefinitions.storages.items);
	storage.set(updates[0].items); expectedStorage.set(updates[0].items);
	assert.deepEqual(new Uint8Array(storage.arrayBuffer), new Uint8Array(expectedStorage.arrayBuffer));
});

// 【WGSLと定数を合成するソースも、編集した内容から再解析する】
// Nodeのimportキャッシュや監視漏れで、GPUのソースとCPUの配置が食い違うことを防ぐ。
test('rebuilds composed shaders and reports every source dependency', async t => {
	const directory = await temporaryDirectory(t);
	const shader = path.join(directory, 'settings.wgsl');
	const constants = path.join(directory, 'constants.ts');
	const entry = path.join(directory, 'settings.shader.ts');
	await writeFile(shader, 'struct Settings { values: array<vec4f, COUNT>, } @group(0) @binding(0) var<uniform> settings: Settings;');
	await writeFile(constants, 'export const count = 2;');
	await writeFile(entry, "import code from './settings.wgsl?raw'; import { count } from './constants.ts'; export default `const COUNT = ${count}u;\\n` + code;");
	const first = await loadWgslShader(entry);
	assert.equal(first.layouts.uniforms.settings.byteLength, 32);
	assert.deepEqual(new Set(first.watchFiles), new Set([entry, shader, constants]));
	const compacted = await loadWgslShader(entry, { compact: true });
	assert.equal(compacted.code, first.code.replace('\n', ' '));
	assert.deepEqual(compacted.layouts, first.layouts);
	await writeFile(constants, 'export const count = 3;');
	const next = await loadWgslShader(entry);
	assert.equal(next.layouts.uniforms.settings.byteLength, 48);
	assert.match(next.code, /COUNT = 3u/);
	await writeFile(entry, 'export default 123;');
	await assert.rejects(loadWgslShader(entry), /must export a WGSL string/);
});

// 【WGSLの圧縮でトークンの区切りと出典を保持する】
// 入れ子のブロックコメント、WGSL固有の改行、ソース断片の端でもトークンを結合しない。
// 出典と利用許諾の行コメントは後続のコードを巻き込まないよう、終端の改行も残す。
test('compacts WGSL trivia while preserving token boundaries and attribution', () => {
	const attribution = '// adapted from the original shader\n// @license MIT\n// @author Original author\n';
	const blockAttribution = '/*! Copyright Example /* attribution detail */ */';
	const source = attribution + 'let\u200Evalue = a-/* outer /* nested */ end */-b; // discard\u0085'
		+ blockAttribution + '\nlet shifted = value >> 2; // end';
	assert.equal(compactWgsl(source), attribution + 'let value = a- -b; ' + blockAttribution + ' let shifted = value >> 2; ');
	assert.equal(compactWgsl('/* start */ empty\n'), ' empty ');
	assert.throws(() => compactWgsl('/* outer /* nested */'), /Unterminated WGSL block comment/);
});

// 【最終JSは配置情報だけを使い、解析器や未使用storageを同梱しない】
// ライブラリの副作用付き初期化はtree-shakingだけでは落ちないため、依存の不在も確認する。
test('bundles only shader code and requested layouts without the reflection runtime', async t => {
	const directory = await temporaryDirectory(t);
	await writeFile(path.join(directory, 'settings.wgsl'), 'struct Settings { color: vec4f, } @group(0) @binding(0) var<uniform> settings: Settings; @group(0) @binding(1) var<storage> unused: array<vec4f, 256>;');
	const result = await build({
		stdin: { contents: "export { uniforms } from './settings.wgsl?shader';", resolveDir: directory },
		plugins: [wgslShaderEsbuildPlugin()], bundle: true, write: false, format: 'esm', minify: true, metafile: true,
	});
	assert.ok(result.outputFiles[0].contents.byteLength < 1000);
	assert.doesNotMatch(result.outputFiles[0].text, /unused|makeShaderDataDefinitions|wgsl_reflect/);
	assert.ok(Object.keys(result.metafile.inputs).every(file => !file.includes('node_modules')));
	const loaded = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
	assert.equal(loaded.uniforms.settings.byteLength, 16);
});

// 【開発サーバーもWGSLと配置情報を同じ依存更新で無効化する】
// 本番だけでなくVite開発中の定数編集でも、バッファ長が古いまま残る回帰を検出する。
test('invalidates composed shader layouts in the Vite development server', async t => {
	const directory = await temporaryDirectory(t);
	const dependency = path.join(directory, 'constants.ts');
	await writeFile(dependency, 'export const count = 2;');
	await writeFile(path.join(directory, 'test.shader.ts'), "import { count } from './constants.ts'; export default `struct Settings { values: array<vec4f, ${count}>, } @group(0) @binding(0) var<uniform> settings: Settings;`;");
	const server = await createServer({ configFile: false, root: directory, plugins: [wgslShaderVitePlugin()], server: { middlewareMode: true }, logLevel: 'silent' });
	try {
		// Viteが整形したJSのexportを読み、WGSLと配置情報が同じ定数で更新されることを確かめる。
		async function loadTransformedShader() {
			const { code } = await server.transformRequest('/test.shader.ts?shader');
			return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
		}
		const first = await loadTransformedShader();
		assert.equal(first.uniforms.settings.byteLength, 32);
		assert.match(first.default, /array<vec4f, 2>/);
		await writeFile(dependency, 'export const count = 4;');
		server.watcher.emit('change', dependency);
		let updated = await loadTransformedShader();
		for (let attempt = 0; updated.uniforms.settings.byteLength === 32 && attempt < 50; attempt++) {
			await new Promise(resolve => setTimeout(resolve, 20));
			updated = await loadTransformedShader();
		}
		assert.equal(updated.uniforms.settings.byteLength, 64, 'composed shader must reload when a constant changes');
		assert.match(updated.default, /array<vec4f, 4>/);
	} finally {
		// 一時ディレクトリを削除する前に、Viteの監視とキャッシュの書き込みを終了する。
		await server.close();
	}
});
