import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `
	export * from './src/gsproj.ts'; export * from './src/gsvm.ts';
	export * from './src/external-assets.ts'; export { createProjectBackupFingerprint } from './src/project-backups.ts';
`, loader: 'ts', resolveDir: fileURLToPath(new URL('../', import.meta.url)) }, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { encodeProjectFile, decodeProjectFile, mapProjectAssetPaths, encodeVisualModuleFile, decodeVisualModuleFile, resolveExternalAssets, createProjectBackupFingerprint } = module.exports;
const asset = () => ({ id: 'asset', name: 'video.mp4', isExternalReference: true, sourceFilePath: 'assets/video.mp4',
	width: 1920, height: 1080, fileDataType: 'video/mp4', fileData: { url: null, size: 0, error: 'missing' }, thumbnailSequence: null });
const project = assets => ({ assets, generatedSpeech: [], timelineScenes: [] });

// 【保存先ごとにパスを相対化し、読み込み時にはそのプロジェクトの場所で解決する】
// 実行中の絶対パスを変更すると、Save As後の再保存やUndoで参照先がずれてしまう。
test('maps paths for each project handle without changing the runtime asset path', async t => {
	const previous = globalThis.window;
	const calls = [];
	globalThis.window = { desktop: { assetProjectPaths: async (paths, id, storing) => {
		calls.push({ paths, id, storing });
		return paths.map(() => storing && id === 'original' ? 'assets/video.mp4' : 'C:/project/assets/video.mp4');
	} } };
	t.after(() => { globalThis.window = previous; });
	const original = project([{ ...asset(), sourceFilePath: 'C:/project/assets/video.mp4' }]);
	const handle = { kind: 'desktop-project-file', id: 'original' };
	const stored = decodeProjectFile(await encodeProjectFile(original, handle));
	assert.equal(stored.assets[0].sourceFilePath, 'assets/video.mp4');
	assert.equal((await mapProjectAssetPaths(stored, handle, false)).assets[0].sourceFilePath, original.assets[0].sourceFilePath);
	const copied = decodeProjectFile(await encodeProjectFile(original, { ...handle, id: 'copy' }));
	assert.equal(copied.assets[0].sourceFilePath, 'C:/project/assets/video.mp4');
	assert.equal(original.assets[0].sourceFilePath, 'C:/project/assets/video.mp4');
	assert.deepEqual(calls.map(({ id, storing }) => [id, storing]), [['original', true], ['original', false], ['copy', true]]);
});

// 【参照切れでも原本を読まず保存・復元し、Webでもパスとモードを維持する】
// 外部参照を埋め込み用の読み出しへ誤って流すと、巨大な動画や参照切れの保存ができなくなる。
test('round trips unavailable references without reading their contents', async t => {
	t.mock.method(globalThis, 'fetch', () => assert.fail('Project saves must not read external assets'));
	const restored = decodeProjectFile(await encodeProjectFile(project([asset()])));
	assert.equal(restored.assets[0].isExternalReference, true);
	assert.equal(restored.assets[0].sourceFilePath, 'assets/video.mp4');
	const previous = globalThis.window;
	globalThis.window = {};
	t.after(() => { globalThis.window = previous; });
	await resolveExternalAssets(restored.assets);
	assert.match(restored.assets[0].fileData.error, /Electron/);
	assert.equal(decodeProjectFile(await encodeProjectFile(restored)).assets[0].sourceFilePath, 'assets/video.mp4');
});

// 【可読性確認を編集にせず、明示リロードの保存対象情報だけを変更済みとして扱う】
// フォーカス復帰でURLやエラーが変わるたびに未保存になったり、Undoで古いURLを使い続けることを防ぐ。
test('resolves current references while keeping runtime health out of dirty tracking', async t => {
	const previous = globalThis.window;
	let current = { url: 'app://external-assets/current', size: 100, error: null };
	globalThis.window = { desktop: { resolveExternalAsset: async () => current } };
	t.after(() => { globalThis.window = previous; });
	const original = project([asset()]);
	const fingerprint = createProjectBackupFingerprint();
	const before = fingerprint(original);
	assert.equal(await resolveExternalAssets(original.assets), true);
	assert.equal(fingerprint(original), before);
	const source = original.assets[0].fileData;
	current = { ...current, size: 200 };
	assert.equal(await resolveExternalAssets(original.assets), false);
	assert.equal(original.assets[0].fileData, source);
	current = { url: null, size: 0, error: 'missing' };
	await resolveExternalAssets(original.assets);
	assert.equal(fingerprint(original), before);
	original.assets[0].width = 1280;
	assert.notEqual(fingerprint(original), before);
});

// 【gsvmだけに原本を埋め込み、プロジェクト内の外部参照を変更しない】
// 可搬なVisual Moduleに実行中だけ有効なURLや元PCのパスを持ち込まない。
test('embeds external bytes in Visual Module exports without changing project storage', async t => {
	t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([1, 2, 3])));
	const external = asset();
	external.fileData = { url: 'app://external-assets/current', size: 3, error: null };
	const file = { kind: 'glitch-studio-visual-module', formatVersion: 1, gsVersion: '1.0.0', name: 'Visual Module', assets: [external], players: [], visualModule: { nodes: [], paramDefs: [], outputDefs: [], automationGraphs: [] } };
	const encoded = await encodeVisualModuleFile(file);
	const restored = decodeVisualModuleFile(encoded, '2.0.0');
	assert.deepEqual(new Uint8Array(await restored.assets[0].fileData.arrayBuffer()), new Uint8Array([1, 2, 3]));
	assert.equal('sourceFilePath' in restored.assets[0], false);
	assert.equal('isExternalReference' in restored.assets[0], false);
	assert.equal(external.isExternalReference, true);
	assert.equal(external.sourceFilePath, 'assets/video.mp4');
});
