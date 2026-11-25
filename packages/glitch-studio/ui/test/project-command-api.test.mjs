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
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', contents: 'export const nativeEffectDefinitions = {};' }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { PROJECT_COMMAND_DEFS, RESOURCES_COMMAND_DEFS, UndoRedo } = loaded.exports;

function fixture() {
	const state = {
		name: { value: 'Original' }, description: { value: '' }, author: { value: '' },
		resolution: { value: { width: 1920, height: 1080 } }, functionCurves: { value: [] },
		assets: { value: [] }, nodesEffects: { value: [] }, timelineScenes: { value: [] },
	};
	return { state, manager: new UndoRedo(state, { ...PROJECT_COMMAND_DEFS, ...RESOURCES_COMMAND_DEFS }) };
}

function assetSource(fileData = new Blob(['original'])) {
	return { width: 100, height: 100, fileDataType: 'image/png', fileData,
		isExternalReference: false, sourceFilePath: null, thumbnailSequence: null };
}



// 【実際のプロジェクト編集を非同期グループでまとめ、途中エラー後にもUndoできる】
// 無効な解像度だけを拒否し、それ以前の名前変更や作成済みCurve Animationを一つの履歴へ残す。
// ダイアログ待ち等のawaitを挟んでも、Redoで新しいIDを生成し直さないことを確認する。
test('retains successful project edits in one undo group after an asynchronous failure', async () => {
	const { state, manager } = fixture();
	let created;
	await assert.rejects(manager.runGroup('Script', async () => {
		await manager.execute('setProjectName', { name: 'Script result' });
		created = await manager.execute('createProjectFunctionCurve', { nameForReference: 'curve' });
		await Promise.resolve();
		await manager.execute('setProjectResolution', { resolution: { width: 0, height: 1080 } });
	}), /positive integers/);
	assert.equal(state.name.value, 'Script result');
	assert.deepEqual(state.resolution.value, { width: 1920, height: 1080 });
	assert.equal(state.functionCurves.value[0].id, created.functionCurveId);
	assert.equal(manager.undoStack.value.length, 1);
	assert.equal(manager.undoStack.value[0].label, 'Script');
	const curveAnimation = structuredClone(state.functionCurves.value[0]);
	manager.undo();
	assert.equal(state.name.value, 'Original');
	assert.deepEqual(state.functionCurves.value, []);
	manager.redo();
	assert.equal(state.name.value, 'Script result');
	assert.deepEqual(state.functionCurves.value, [curveAnimation]);
});

// 【Curve Animation複製の所有IDはCommandが作成し、呼び出し側の値を書き換えない】
// 同じポイントIDを共有すると、複製元の編集やUndoによって複製先へ意図しない変更が伝わり得る。
test('duplicates Curve Animations with independent point IDs and stable redo', () => {
	const { state, manager } = fixture();
	const data = { type: 'bezier', isXNormalized: false, isYNormalized: false, points: [{ x: 0, y: 1, bezierControlPointA: [0, 0], bezierControlPointB: [1, 0] }] };
	const original = manager.commit('createProjectFunctionCurve', { nameForReference: 'curve', data });
	const duplicated = manager.commit('duplicateProjectFunctionCurve', original);
	const source = state.functionCurves.value[0];
	const copy = structuredClone(state.functionCurves.value[1]);
	assert.equal(copy.nameForReference, 'curve_2');
	assert.notEqual(copy.id, source.id);
	assert.notEqual(copy.points[0].id, source.points[0].id);
	assert.equal(copy.id, duplicated.functionCurveId);
	data.points[0].y = 99;
	assert.equal(source.points[0].y, 1);
	manager.undo(); manager.redo();
	assert.deepEqual(state.functionCurves.value[1], copy);
});

// 【共有の固定カーブをCommandで作成・複製・型変更できる】
// 型変更後もIDを維持して参照を解決できるようにする。無効な設定は保存せず、Undoでは元の型と設定を復元する。
test('creates, duplicates and replaces fixed Function Curves through the public contracts', () => {
	const { state, manager } = fixture();
	const original = manager.commit('createProjectFunctionCurve', { nameForReference: 'flash', data: { type: 'pulse', dutyCycle: 0.25 } });
	const duplicate = manager.commit('duplicateProjectFunctionCurve', original);
	assert.deepEqual(state.functionCurves.value, [
		{ id: original.functionCurveId, nameForReference: 'flash', type: 'pulse', dutyCycle: 0.25 },
		{ id: duplicate.functionCurveId, nameForReference: 'flash_2', type: 'pulse', dutyCycle: 0.25 },
	]);
	const change = { ...original, definition: { nameForReference: 'flash', type: 'steps', levelCount: 4 } };
	manager.commit('replaceProjectFunctionCurve', change);
	assert.deepEqual(state.functionCurves.value[0], { ...change.definition, id: original.functionCurveId });
	for (const data of [{ type: 'steps', levelCount: 1 }, { type: 'steps', levelCount: 3.5 }, { type: 'pulse', dutyCycle: 1.1 }, { type: 'deadZone', deadZoneWidth: -0.1 }, { type: 'easing', family: 'quad' }]) {
		assert.throws(() => manager.commit('createProjectFunctionCurve', { data }));
	}
	manager.undo();
	assert.deepEqual(state.functionCurves.value[0], { id: original.functionCurveId, nameForReference: 'flash', type: 'pulse', dutyCycle: 0.25 });
	manager.redo();
	assert.deepEqual(state.functionCurves.value[0], { ...change.definition, id: original.functionCurveId });
});

// 【公開CommandでBackの係数とElasticの周期を保存・検証する】
// 0の係数や非既定の周期を保持し、無効な調整値で既存の共有定義を変更しない。
test('stores and validates family-specific easing settings through public curve commands', () => {
	const { state, manager } = fixture();
	const back = { type: 'easing', family: 'back', direction: 'out', overshootCoefficient: 0 };
	const target = manager.commit('createProjectFunctionCurve', { nameForReference: 'motion', data: back });
	const identity = { id: target.functionCurveId, nameForReference: 'motion' };
	assert.deepEqual(state.functionCurves.value[0], { ...identity, ...back });
	const elastic = { type: 'easing', family: 'elastic', direction: 'inOut', period: 0.6 };
	manager.commit('replaceProjectFunctionCurve', { ...target, definition: { ...identity, ...elastic } });
	for (const data of [{ ...elastic, period: 0 }, { ...elastic, period: Infinity }, { ...back, overshootCoefficient: -1 }]) {
		assert.throws(() => manager.commit('replaceProjectFunctionCurve', { ...target, definition: { ...identity, ...data } }));
	}
	assert.deepEqual(state.functionCurves.value[0], { ...identity, ...elastic });
	manager.undo();
	assert.deepEqual(state.functionCurves.value[0], { ...identity, ...back });
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
