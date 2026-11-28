import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { compileScript, parse } from 'vue/compiler-sfc';
import { createRenderer, h } from 'vue';
import { i18nPlugin } from './helpers/i18n.mjs';

const directory = fileURLToPath(new URL('../', import.meta.url));
const descriptor = parse(await readFile(new URL('../src/components/GsNodesEffectWebExportDialog.vue', import.meta.url), 'utf8')).descriptor;
const script = compileScript(descriptor, { id: 'nodes-effect-web-export-dialog' }).content;
const bundle = await build({
	absWorkingDir: directory,
	stdin: { loader: 'ts', resolveDir: `${directory}/src/components`, contents: script + `
		export { applicationActivity, parseNodesEffectWebExportParameters };
		export { DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS } from '@gs/glitch-studio_shared/portable-nodes-effect.ts';
	` },
	define: { __ELECTRON__: 'true' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'web-export-platform', setup(builder) {
		// ダイアログの状態遷移と実際の成果物生成を通す。DOM・ビルド済みGPUランタイムだけを境界で差し替える。
		builder.onResolve({ filter: /\.vue$|(?:effect-definitions|native-effects[\\/]definitions)\.ts$/ }, ({ path }) => ({ path, namespace: 'web-export-platform' }));
		builder.onLoad({ filter: /.*/, namespace: 'web-export-platform' }, ({ path }) => ({ loader: 'ts', contents:
			path.endsWith('.vue') ? 'export default {};'
					: 'export const nativeEffectDefinitions = {};',
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const Dialog = { ...loaded.exports.default, render: () => null };
const { applicationActivity, parseNodesEffectWebExportParameters, DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS } = loaded.exports;
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });

function fixture(t, fileData = new Blob(['asset'])) {
	const downloads = [];
	const calls = [];
	let name;
	let chunks = [];
	const desktop = {
		async chooseExportSaveFile(value) { name = value; calls.push('choose'); return { id: 'target', name }; },
		async buildPortableNodesEffect(id, request) {
			calls.push(['build', id, request]);
			return { elementSource: 'var GlitchStudioNodesEffectEmbed = { registerNodesEffectElement: capture };',
				workerSource: request.executionTarget === 'mainThread' ? null : '// test worker' };
		},
		async cancelPortableNodesEffect(id) { calls.push(['cancel', id]); },
		async beginExportFile() { chunks = []; calls.push('begin'); },
		async appendExportFile(_id, chunk) { chunks.push(chunk); },
		async finishExportFile() { downloads.push({ name, blob: new Blob(chunks) }); calls.push('finish'); },
		async releaseExportFile() { calls.push('release'); },
	};
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop } });
	t.after(() => { if (originalWindow == null) delete globalThis.window; else Object.defineProperty(globalThis, 'window', originalWindow); });
	const prepared = {
		name: 'Nodes Effect', gsVersion: 'test', customShaderEffects: [], aspectRatio: 2,
		settings: { ...DEFAULT_PORTABLE_NODES_EFFECT_SETTINGS }, initialParameters: {},
		diagnostics: { resolutionNodes: [] },
		runtimeRequirements: { effectIds: [], requiresExpressions: false, requiresCustomShaderEffects: false, parameterFeatures: ['keyframes'] },
		assets: [{ id: 'asset', name: 'Asset', sourceFileName: 'asset.png', width: 1, height: 1, fileDataType: 'image/png', fileData }],
		nodesEffect: { nodes: [], paramDefs: [{ id: 'speed', nameForReference: 'speed', dataType: { kind: 'scalar' }, canNode: false,
			ui: { label: 'Speed', control: {} }, defaultValue: 1 }],
		customParameterDefs: [], customParameterValues: {}, outputDefs: [], functionCurves: [], primaryInputId: null, primaryOutputId: null },
	};
	let input;
	const app = renderer.createApp({ render: () => h(Dialog, { prepared, ref: instance => { if (instance != null) input = instance.$.setupState; } }) });
	app.mount({});
	let unmounted = false;
	const unmount = () => { if (!unmounted) { unmounted = true; app.unmount(); } };
	t.after(unmount);
	return { input, downloads, calls, desktop, unmount };
}

function readArtwork(javascript) {
	let artwork;
	runInNewContext(javascript, { capture: (_tag, data) => { artwork = data; } });
	return artwork;
}

// 【手入力した公開値の型・入れ子・参照名を、書き出しダイアログで検証する】
// 配布先では検証しないため、ユーザーが編集したJSONの誤りは書き出し前に報告する。
// HDRのRGBは保持し、配列の上限や配布先で使えないPlayer参照はここで拒否する。
test('validates handwritten public JSON while preserving HDR colors and nested values', () => {
	const nodesEffect = { paramDefs: {
		speedId: { dataType: { kind: 'scalar' }, nameForReference: 'Speed', ui: { label: 'Speed' }, defaultValue: 1 },
		colorId: { dataType: { kind: 'color' }, nameForReference: 'Color', ui: { label: 'Color' }, defaultValue: [0, 0, 0, 1] },
		pointsId: {
			dataType: { kind: 'array', elementType: { kind: 'vector' } }, nameForReference: 'Points', maxElements: 2,
			ui: { label: 'Points', control: { element: {} } }, defaultValue: [], element: { defaultValue: [0, 0] },
		},
		tracksId: {
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: { kind: 'audioSource' } } } },
			nameForReference: 'Tracks', ui: { label: 'Tracks', control: { element: { fields: { audio: { label: 'Audio', control: {} } } } } },
			defaultValue: [], element: { defaultValue: { audio: null }, fields: { audio: { defaultValue: null } } },
		},
	} };
	const parseParameters = json => parseNodesEffectWebExportParameters(nodesEffect, json);
	const values = { Speed: 2, Color: [-1, 3, 0.25, 0.5], Points: [[0.2, -0.1]], Tracks: [{ audio: null }] };
	assert.deepEqual(parseParameters(JSON.stringify(values)), values);
	assert.throws(() => parseParameters('{"Color":[1,1,1,2]}'), /Invalid color/);
	assert.throws(() => parseParameters('{"Speed":1e999}'), /Invalid scalar/);
	assert.throws(() => parseParameters('{"speed":1}'), /Unknown public parameter/);
	assert.throws(() => parseParameters('{"Points":[[0,0],[0,0],[0,0]]}'), /Invalid array/);
	assert.throws(() => parseParameters('{"Tracks":[{"audio":{"type":"player","playerId":"mic"}}]}'), /Invalid audioSource/);
});

// 【描画の初期値はメインスレッド・自動FPSで、数値指定に戻しても入力した上限を失わない】
// 自動を0fpsとして扱わず、カスタムの入力エラーはそのモードだけで書き出しを止める。
test('defaults to main-thread rendering with automatic pacing and preserves the custom limit', t => {
	const f = fixture(t);
	assert.equal(f.input.executionTarget, 'mainThread');
	assert.equal(f.input.fpsMode, 'auto');
	assert.equal(f.input.settings.fpsLimit, null);
	f.input.fpsMode = 'custom';
	f.input.customFpsLimit = 29.97;
	assert.equal(f.input.settings.fpsLimit, 29.97);
	f.input.fpsMode = 'auto';
	assert.equal(f.input.settings.fpsLimit, null);
	f.input.fpsMode = 'custom';
	assert.equal(f.input.settings.fpsLimit, 29.97);
	f.input.customFpsLimit = 0;
	assert.notEqual(f.input.validationError, null);
	f.input.fpsMode = 'auto';
	assert.equal(f.input.validationError, null);
});

// 【非同期の素材読み出し中の操作は、開始済みの書き出し内容や形式を変えない】
// 保存ボタンの再実行で二重に保存せず、公開値・倍率・形式・描画の実行先を一貫したスナップショットとして配布する。
test('saves one HTML snapshot despite edits and duplicate requests during asset reading', async t => {
	const started = Promise.withResolvers();
	const released = Promise.withResolvers();
	const f = fixture(t, new class extends Blob {
		async arrayBuffer() { started.resolve(); await released.promise; return super.arrayBuffer(); }
	}(['original asset']));
	f.input.format = 'html';
	f.input.executionTarget = 'worker';
	f.input.initialParameters = '{"speed":2}';
	f.input.resolutionScale = 0.5;
	const downloading = f.input.download();
	await started.promise;
	assert.equal(applicationActivity.isExporting.value, true);
	f.input.format = 'zip';
	f.input.executionTarget = 'mainThread';
	f.input.initialParameters = '{"speed":9}';
	f.input.resolutionScale = 0.25;
	f.input.fpsMode = 'custom';
	f.input.customFpsLimit = 30;
	await f.input.download();
	released.resolve();
	await downloading;
	assert.equal(applicationActivity.isExporting.value, false);
	assert.equal(f.downloads.length, 1);
	assert.equal(f.downloads[0].name, 'Nodes Effect.html');
	const html = await f.downloads[0].blob.text();
	assert.match(html, /test worker/);
	const artwork = readArtwork(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
	assert.deepEqual({ ...artwork.settings }, { resolutionScale: 0.5, fpsLimit: null });
	assert.equal(artwork.initialParameters.speed, 2);
	assert.equal(Buffer.from(artwork.assets[0].fileDataBase64, 'base64').toString(), 'original asset');
	const buildCalls = f.calls.filter(call => Array.isArray(call) && call[0] === 'build');
	assert.equal(buildCalls.length, 1);
	assert.equal(buildCalls[0][2].executionTarget, 'worker');
	assert.deepEqual(f.calls.find(call => Array.isArray(call) && call[0] === 'build')[2].parameterFeatures, ['keyframes']);
	assert.deepEqual(f.calls.slice(-2), ['finish', 'release']);
});

// 【書き出し受付の失敗や入力エラーから、ダイアログを開き直さずに再試行できる】
// 更新中の受付拒否で永久に処理中になったり、過去のエラーで保存ボタンが無効のままになることを防ぐ。
test('recovers from activity rejection and invalid public values and saves a complete ZIP', async t => {
	const f = fixture(t);
	const finishUpdate = applicationActivity.beginUpdate();
	assert.notEqual(finishUpdate, null);
	try { await f.input.download(); } finally { finishUpdate(); }
	assert.match(f.input.exportError, /updated/);
	assert.equal(f.input.exporting, false);
	f.input.initialParameters = '{"speed":false}';
	await f.input.download();
	assert.notEqual(f.input.validationError, null);
	assert.equal(f.downloads.length, 0);
	f.input.initialParameters = '{"speed":3}';
	f.input.fpsMode = 'custom';
	f.input.customFpsLimit = 24;
	await f.input.download();
	assert.equal(f.input.exportError, null);
	assert.equal(f.downloads.length, 1);
	assert.equal(f.downloads[0].name, 'Nodes Effect.zip');
	const bytes = new Uint8Array(await f.downloads[0].blob.arrayBuffer());
	const view = new DataView(bytes.buffer);
	const entries = new Map();
	for (let offset = 0; view.getUint32(offset, true) === 0x04034b50;) {
		const size = view.getUint32(offset + 18, true);
		const length = view.getUint16(offset + 26, true);
		const dataOffset = offset + 30 + length;
		entries.set(new TextDecoder().decode(bytes.subarray(offset + 30, dataOffset)), new TextDecoder().decode(bytes.subarray(dataOffset, dataOffset + size)));
		offset = dataOffset + size;
	}
	assert.deepEqual([...entries.keys()], ['index.html', 'artwork.js', 'README.md', 'assets/1.png']);
	assert.equal(entries.get('assets/1.png'), 'asset');
	assert.match(entries.get('index.html'), /src="\.\/artwork.js"/);
	assert.doesNotMatch(entries.get('artwork.js'), /test worker/);
	// VMで登録引数だけを取り出す。モジュールURLでの解決はembedのブラウザテストで通す。
	const artwork = readArtwork(entries.get('artwork.js').replace('import.meta.url', '"https://example.test/artwork.js"'));
	assert.equal(artwork.assets[0].fileDataPath, 'assets/1.png');
	assert.equal(artwork.assets[0].fileDataBase64, undefined);
	assert.equal(artwork.initialParameters.speed, 3);
	assert.equal(artwork.settings.fpsLimit, 24);
	assert.equal(applicationActivity.isExporting.value, false);
});

// 【所属セッションを閉じた後に非同期素材の読み出しが終わっても保存しない】
// 破棄済み画面から遅れてダウンロードを開始せず、アプリの書き出し状態も必ず解放する。
test('suppresses saves after unmounting during asset reading', async t => {
	const started = Promise.withResolvers();
	const released = Promise.withResolvers();
	const f = fixture(t, new class extends Blob {
		async arrayBuffer() { started.resolve(); await released.promise; return super.arrayBuffer(); }
	}(['asset']));
	f.input.format = 'html';
	const downloading = f.input.download();
	await started.promise;
	f.unmount();
	released.resolve();
	await downloading;
	assert.equal(f.downloads.length, 0);
	assert.equal(applicationActivity.isExporting.value, false);
});

// 【実行中のビルドを中断し、保存せず受付状態を解放する】
// 素材の準備後でもキャンセルでき、前回の要求IDが次の書き出しへ残らないことを確認する。
test('cancels a running desktop build and allows a clean retry', async t => {
	const f = fixture(t);
	const started = Promise.withResolvers();
	const pending = Promise.withResolvers();
	const originalBuild = f.desktop.buildPortableNodesEffect;
	let requestId;
	f.desktop.buildPortableNodesEffect = async id => { requestId = id; started.resolve(); return pending.promise; };
	f.desktop.cancelPortableNodesEffect = async id => { assert.equal(id, requestId); pending.reject(new Error('Export canceled')); };
	const exporting = f.input.download();
	await started.promise;
	f.input.closeDialog();
	await exporting;
	assert.equal(f.downloads.length, 0);
	assert.equal(f.input.exportError, null);
	assert.equal(applicationActivity.isExporting.value, false);
	assert.equal(f.calls.at(-1), 'release');
	f.desktop.buildPortableNodesEffect = originalBuild;
	await f.input.download();
	assert.equal(f.downloads.length, 1);
});

// 【Web版からの直接呼び出しと保存先選択のキャンセルでビルドを開始しない】
// UIの表示条件だけに依存せず、不要な素材読み出しやバックグラウンド処理を防ぐ。
test('does not start an export without desktop capabilities or a save destination', async t => {
	const f = fixture(t);
	window.desktop = null;
	await f.input.download();
	assert.notEqual(f.input.exportError, null);
	assert.deepEqual(f.calls, []);
	window.desktop = f.desktop;
	f.desktop.chooseExportSaveFile = async () => null;
	await f.input.download();
	assert.deepEqual(f.calls, []);
	assert.equal(applicationActivity.isExporting.value, false);
});
