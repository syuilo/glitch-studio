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
const descriptor = parse(await readFile(new URL('../src/components/GsCustomNodeGraphEffectWebExportDialog.vue', import.meta.url), 'utf8')).descriptor;
const script = compileScript(descriptor, { id: 'custom-node-graph-effect-web-export-dialog' }).content;
const bundle = await build({
	absWorkingDir: directory,
	stdin: { loader: 'ts', resolveDir: `${directory}/src/components`, contents: script + `
		export { applicationActivity };
		export { DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS } from '@gs/glitch-studio_shared/portable-custom-node-graph-effect.ts';
	` },
	define: { __ELECTRON__: 'true' },
	bundle: true, platform: 'node', format: 'cjs', external: ['vue'], write: false,
	plugins: [i18nPlugin, { name: 'web-export-platform', setup(builder) {
		// ダイアログの状態遷移と実際の成果物生成を通す。DOM・ビルド済みGPUランタイムだけを境界で差し替える。
		builder.onResolve({ filter: /\.vue$|effect-definitions\.ts$/ }, ({ path }) => ({ path, namespace: 'web-export-platform' }));
		builder.onLoad({ filter: /.*/, namespace: 'web-export-platform' }, ({ path }) => ({ loader: 'ts', contents:
			path.endsWith('.vue') ? 'export default {};'
					: 'export const effectDefinitions = {};',
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const Dialog = { ...loaded.exports.default, render: () => null };
const { applicationActivity, DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS } = loaded.exports;
const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });

function fixture(t, fileData = new Blob(['asset'])) {
	const downloads = [];
	const calls = [];
	let name;
	let chunks = [];
	const desktop = {
		async chooseExportSaveFile(value) { name = value; calls.push('choose'); return { id: 'target', name }; },
		async buildPortableCustomNodeGraphEffect(id, requirements) { calls.push(['build', id, requirements]); return { elementSource: 'var GlitchStudioCustomNodeGraphEffectEmbed = { registerCustomNodeGraphEffectElement: capture };', workerSource: '// test worker' }; },
		async cancelPortableCustomNodeGraphEffect(id) { calls.push(['cancel', id]); },
		async beginExportFile() { chunks = []; calls.push('begin'); },
		async appendExportFile(_id, chunk) { chunks.push(chunk); },
		async finishExportFile() { downloads.push({ name, blob: new Blob(chunks) }); calls.push('finish'); },
		async releaseExportFile() { calls.push('release'); },
	};
	const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktop } });
	t.after(() => { if (originalWindow == null) delete globalThis.window; else Object.defineProperty(globalThis, 'window', originalWindow); });
	const prepared = {
		name: 'Custom Node Graph Effect', gsVersion: 'test', customShaderEffects: [], aspectRatio: 2,
		settings: { ...DEFAULT_PORTABLE_CUSTOM_NODE_GRAPH_EFFECT_SETTINGS }, initialParameters: {},
		diagnostics: { players: [], resolutionNodes: [] },
		runtimeRequirements: { effectIds: [], requiresExpressions: false, requiresParameterDefaultExpressions: false, requiresCustomShaderEffects: false },
		assets: [{ id: 'asset', name: 'Asset', width: 1, height: 1, fileDataType: 'image/png', fileData }],
		customNodeGraphEffect: { nodes: [], paramDefs: [{ id: 'speed', nameForReference: 'speed', dataType: { kind: 'scalar' }, canNode: false,
			ui: { label: 'Speed', control: {} }, defaultValue: { inputSource: 'literal', value: 1 } }],
		customParameterDefs: [], customParameterValues: {}, outputDefs: [], automationGraphs: [], primaryInputId: null, primaryOutputId: null },
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

// 【初期値の自動と数値指定を切り替えても、入力した上限を失わない】
// 自動を0fpsとして扱わず、カスタムの入力エラーはそのモードだけで書き出しを止める。
test('defaults to automatic pacing and retains the custom limit across mode changes', t => {
	const f = fixture(t);
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
// 保存ボタンの再実行で二重に保存せず、公開値・倍率・形式を一貫したスナップショットとして配布する。
test('saves one HTML snapshot despite edits and duplicate requests during asset reading', async t => {
	const started = Promise.withResolvers();
	const released = Promise.withResolvers();
	const f = fixture(t, new class extends Blob {
		async arrayBuffer() { started.resolve(); await released.promise; return super.arrayBuffer(); }
	}(['original asset']));
	f.input.format = 'html';
	f.input.initialParameters = '{"speed":2}';
	f.input.resolutionScale = 0.5;
	const downloading = f.input.download();
	await started.promise;
	assert.equal(applicationActivity.isExporting.value, true);
	f.input.format = 'zip';
	f.input.initialParameters = '{"speed":9}';
	f.input.resolutionScale = 0.25;
	f.input.fpsMode = 'custom';
	f.input.customFpsLimit = 30;
	await f.input.download();
	released.resolve();
	await downloading;
	assert.equal(applicationActivity.isExporting.value, false);
	assert.equal(f.downloads.length, 1);
	assert.equal(f.downloads[0].name, 'Custom Node Graph Effect.html');
	const html = await f.downloads[0].blob.text();
	const artwork = readArtwork(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
	assert.equal(artwork.settings.resolutionScale, 0.5);
	assert.equal(artwork.settings.fpsLimit, null);
	assert.equal(artwork.initialParameters.speed, 2);
	assert.equal(Buffer.from(artwork.assets[0].fileDataBase64, 'base64').toString(), 'original asset');
	assert.equal(f.calls.filter(call => Array.isArray(call) && call[0] === 'build').length, 1);
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
	assert.equal(f.downloads[0].name, 'Custom Node Graph Effect.zip');
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
	assert.deepEqual([...entries.keys()], ['index.html', 'artwork.js', 'README.md']);
	assert.match(entries.get('index.html'), /src="\.\/artwork.js"/);
	const artwork = readArtwork(entries.get('artwork.js'));
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
	const originalBuild = f.desktop.buildPortableCustomNodeGraphEffect;
	let requestId;
	f.desktop.buildPortableCustomNodeGraphEffect = async id => { requestId = id; started.resolve(); return pending.promise; };
	f.desktop.cancelPortableCustomNodeGraphEffect = async id => { assert.equal(id, requestId); pending.reject(new Error('Export canceled')); };
	const exporting = f.input.download();
	await started.promise;
	f.input.closeDialog();
	await exporting;
	assert.equal(f.downloads.length, 0);
	assert.equal(f.input.exportError, null);
	assert.equal(applicationActivity.isExporting.value, false);
	assert.equal(f.calls.at(-1), 'release');
	f.desktop.buildPortableCustomNodeGraphEffect = originalBuild;
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
