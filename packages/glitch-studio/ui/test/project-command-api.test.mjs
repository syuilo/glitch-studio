import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { PROJECT_COMMAND_DEFS } from './src/commands/project.ts';
		export { RESOURCES_COMMAND_DEFS } from './src/commands/resources.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
	` },
	plugins: [{ name: 'project-command-effects', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', contents: 'export const effectDefinitions = {};' }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { PROJECT_COMMAND_DEFS, RESOURCES_COMMAND_DEFS, UndoRedo } = loaded.exports;

function fixture() {
	const state = {
		name: { value: 'Original' }, description: { value: '' }, author: { value: '' },
		resolution: { value: { width: 1920, height: 1080 } }, automationGraphs: { value: [] },
		assets: { value: [] }, players: { value: [] }, visualModules: { value: [] }, timelineScenes: { value: [] },
	};
	return { state, manager: new UndoRedo(state, { ...PROJECT_COMMAND_DEFS, ...RESOURCES_COMMAND_DEFS }) };
}

function assetSource(fileData = new Blob(['original'])) {
	return { width: 100, height: 100, fileDataType: 'image/png', fileData,
		isExternalReference: false, sourceFilePath: null, thumbnailSequence: null };
}

// 【実際のプロジェクト編集を非同期グループでまとめ、途中エラー後にもUndoできる】
// 無効な解像度だけを拒否し、それ以前の名前変更や作成済みグラフを一つの履歴へ残す。
// ダイアログ待ち等のawaitを挟んでも、Redoで新しいIDを生成し直さないことを確認する。
test('retains successful project edits in one undo group after an asynchronous failure', async () => {
	const { state, manager } = fixture();
	let created;
	await assert.rejects(manager.runGroup('Script', async () => {
		await manager.execute('setProjectName', { name: 'Script result' });
		created = await manager.execute('createProjectAutomationGraph', { nameForReference: 'curve' });
		await Promise.resolve();
		await manager.execute('setProjectResolution', { resolution: { width: 0, height: 1080 } });
	}), /positive integers/);
	assert.equal(state.name.value, 'Script result');
	assert.deepEqual(state.resolution.value, { width: 1920, height: 1080 });
	assert.equal(state.automationGraphs.value[0].id, created.automationGraphId);
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(manager.undoStack.value[0].label, 'Script');
	const graph = structuredClone(state.automationGraphs.value[0]);
	manager.undo();
	assert.equal(state.name.value, 'Original');
	assert.deepEqual(state.automationGraphs.value, []);
	manager.redo();
	assert.equal(state.name.value, 'Script result');
	assert.deepEqual(state.automationGraphs.value, [graph]);
});

// 【グラフ複製の所有IDはCommandが作成し、呼び出し側の値を書き換えない】
// 同じポイントIDを共有すると、複製元の編集やUndoによって複製先へ意図しない変更が伝わり得る。
test('duplicates Automation Graphs with independent point IDs and stable redo', () => {
	const { state, manager } = fixture();
	const data = { isNormalized: false, points: [{ x: 0, y: 1, bezierControlPointA: [0, 0], bezierControlPointB: [1, 0] }] };
	const original = manager.commit('createProjectAutomationGraph', { nameForReference: 'curve', data });
	const duplicated = manager.commit('duplicateProjectAutomationGraph', original);
	const source = state.automationGraphs.value[0];
	const copy = structuredClone(state.automationGraphs.value[1]);
	assert.equal(copy.nameForReference, 'curve_2');
	assert.notEqual(copy.id, source.id);
	assert.notEqual(copy.points[0].id, source.points[0].id);
	assert.equal(copy.id, duplicated.automationGraphId);
	data.points[0].y = 99;
	assert.equal(source.points[0].y, 1);
	manager.undo(); manager.redo();
	assert.deepEqual(state.automationGraphs.value[1], copy);
});

// 【素材名の変更をUndoでき、同値設定ではRedoを消さない】
// 旧Commandの未実装だったUndoを補完し、スクリプトからの同値設定も履歴を破壊しないようにする。
test('undoes asset renaming and preserves redo for no-op or invalid targets', () => {
	const { state, manager } = fixture();
	const { assetId } = manager.commit('createAsset', { asset: { name: 'Image', ...assetSource() } });
	manager.commit('setAssetName', { assetId, name: 'Renamed' });
	manager.undo();
	assert.equal(state.assets.value[0].name, 'Image');
	manager.commit('setAssetName', { assetId, name: 'Image' });
	assert.throws(() => manager.commit('setAssetName', { assetId: 'missing', name: 'Invalid' }), /not found/);
	assert.equal(manager.redoStack.value.length, 1);
	manager.redo();
	assert.equal(state.assets.value[0].name, 'Renamed');
});

// 【異なるBlobとサムネイルを同値判定で失わず、Undoで元の原本に戻す】
// JSON向け比較ではBlob同士が空オブジェクトとして同一視されるため、素材差し替え固有の検証を行う。
test('records replacement files and thumbnail blobs without changing asset identity', () => {
	const { state, manager } = fixture();
	const before = assetSource();
	const { assetId } = manager.commit('createAsset', { asset: { name: 'Image', ...before } });
	const asset = state.assets.value[0];
	const after = { ...before, fileData: new Blob(['replacement']) };
	manager.commit('replaceAssetSource', { assetId, source: after });
	assert.equal(state.assets.value[0], asset);
	assert.equal(asset.fileData, after.fileData);
	manager.undo();
	assert.equal(asset.fileData, before.fileData);
	manager.redo();
	const thumbnail = new Blob(['thumbnail']);
	manager.commit('replaceAssetSource', { assetId, source: { ...after, thumbnailSequence: { width: 10, height: 10, frames: [{ timestampSeconds: 0, fileData: thumbnail }] } } });
	const nextThumbnail = new Blob(['another thumbnail']);
	manager.commit('replaceAssetSource', { assetId, source: { ...after, thumbnailSequence: { width: 10, height: 10, frames: [{ timestampSeconds: 0, fileData: nextThumbnail }] } } });
	assert.equal(asset.thumbnailSequence.frames[0].fileData, nextThumbnail);
	manager.undo();
	assert.equal(asset.thumbnailSequence.frames[0].fileData, thumbnail);
});
