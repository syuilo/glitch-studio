import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
// コマンド・履歴・差分生成は実コード。ブラウザ依存の設定とエフェクト登録だけを置き換える。
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { AppStateManager } from './src/AppStateManager.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '../shared/src/project/renderer-state.ts';
		export { default as definition } from '../shared/src/effect/fx/testStructArray/_def_.ts';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'sync-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '../shared/src/effect/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, { ...console, log() {} });
const { AppStateManager, RendererProjectSynchronizer, applyRendererProjectChanges, definition } = module.exports;

function fixture(t, count = 1, overrides = {}) {
	const manager = new AppStateManager();
	const nodes = Array.from({ length: count }, (_, i) => ({
		id: 'node-' + i, type: 'effect', effectId: definition.id, pos: { x: 0, y: 0 }, isBypass: false, resolution: { mode: 'auto' },
		params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
	}));
	const visualModule = { id: 'module', name: 'Module', nodes, paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] };
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	manager.state.visualModules.value = [visualModule];
	manager.state.timelineScenes.value = [scene];
	let replica = structuredClone({ visualModules: [visualModule], timelineScenes: [scene] });
	const batches = [], snapshots = [], errors = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); replica = applyRendererProjectChanges(replica, changes); },
		replace: async state => { snapshots.push(state); replica = state; },
		onUpdated() {}, onError: error => errors.push(error), ...overrides,
	});
	t.after(() => sync.dispose());
	const target = { visualModuleId: 'module', nodeId: 'node-0', paramPath: ['buzzs', 'first', 'x'] };
	const value = state => state.visualModules[0].nodes[0].params.buzzs.value[0].binding.value.x.value;
	return { manager, sync, target, batches, snapshots, errors, value: () => value(replica), get replica() { return replica; } };
}

// 【プロジェクトのノード数を増やしても、通常編集の送信量は変更ノード一つ分に収まる】
// deep watchで全Moduleを複製する経路が復活しないことを、実際の送信データで確認する。
// 配列内の末端値も、履歴のマージ・Undo・Redoを含めて確定値と編集内容の通知が一致する必要がある。
test('sends one node regardless of graph size and synchronizes merged edits undo and redo', async t => {
	const sizes = [];
	for (const count of [1, 1000]) {
		const f = fixture(t, count);
		f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.25 }, 'drag');
		f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.75 }, 'drag');
		await f.sync.flush();
		assert.equal(f.batches.length, 1);
		assert.equal(f.batches[0].length, 1);
		assert.equal(f.batches[0][0].type, 'node');
		assert.deepEqual(f.batches[0][0].changes, [{ type: 'parameter', kind: 'value' }]);
		assert.deepEqual(f.batches[0][0].target, { visualModuleId: 'module' });
		assert.equal(f.value(), 0.75);
		sizes.push(JSON.stringify(f.batches[0]).length);
		f.manager.undo();
		await f.sync.flush();
		assert.equal(f.value(), 0);
		f.manager.redo();
		await f.sync.flush();
		assert.equal(f.value(), 0.75);
		for (const batch of f.batches) assert.deepEqual(batch[0].changes, [{ type: 'parameter', kind: 'value' }]);
		assert.deepEqual(f.errors, []);
	}
	assert.equal(sizes[0], sizes[1]);
});

// 【構造変更は後続の値編集に上書きされず、Module置換は古いノード差分を吸収する】
// 同じターンで配列追加→値編集、ノード編集→削除を行っても、途中の編集内容を失ったり
// 削除済みIDへの更新を送ったりしない。Undoでも最終的なグラフを一度で反映する。
test('coalesces structural changes without replaying obsolete node updates', async t => {
	const f = fixture(t);
	f.manager.commit('addArrayParamElement', { ...f.target, paramPath: ['buzzs'] });
	f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.5 });
	await f.sync.flush();
	assert.deepEqual(f.batches[0][0].changes, [{ type: 'parameter', kind: 'arrayElements' }, { type: 'parameter', kind: 'value' }]);
	assert.equal(f.replica.visualModules[0].nodes[0].params.buzzs.value.length, 2);
	f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.9 });
	f.manager.commit('removeNode', { visualModuleId: 'module', nodeId: 'node-0' });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['visualModule']);
	assert.equal(f.replica.visualModules[0].nodes.length, 0);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.value(), 0.9);
	assert.deepEqual(f.errors, []);
});

// 【追加直後のScene・レイヤーの編集は親の最新スナップショットに取り込む】
// まだ受信側に存在しない子IDへ先に差分を送ったり、削除済みレイヤーの並びを送ったりしない。
test('absorbs child edits into newly added scenes and layers', async t => {
	const f = fixture(t);
	const inline = { id: 'inline', name: 'Inline', layerType: 'inlineVisualModule', visualModule: structuredClone(f.replica.visualModules[0]),
		clips: [], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] };
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: inline });
	f.manager.commit('updateParamAsLiteral', { sceneId: 'scene', inlineVisualModuleLayerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath, value: 0.3 });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layer', 'layerOrder']);
	assert.equal(f.replica.timelineScenes[0].layers[0].visualModule.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.3);
	f.manager.commit('addScene', { id: 'child', name: 'Child', resolution: { mode: 'project' }, layers: [] });
	f.manager.commit('addTimelineLayer', { sceneId: 'child', layer: inline });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['scene']);
	assert.equal(f.replica.timelineScenes[1].layers.length, 1);
	f.manager.commit('removeTimelineLayer', { sceneId: 'child', layerId: 'inline' });
	f.manager.commit('removeScene', { sceneId: 'child' });
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes.length, 1);
	assert.deepEqual(f.errors, []);
});

// 【Module引数の履歴と、同時に編集したノード・合成設定の変更内容を通知する】
// 同じレイヤーだからと最後の編集種別だけ残すと、合成設定やリセットが通常の値編集に
// 化けてしまう。Inline Moduleの部分編集も吸収せず、レンダラーが判断する材料を保つ。
test('retains layer edit kinds through merged history and simultaneous inline edits', async t => {
	const f = fixture(t);
	const visualModule = structuredClone(f.replica.visualModules[0]);
	visualModule.paramDefs = [{ id: 'amount', nameForReference: 'Amount', dataType: { kind: 'scalar' },
		ui: { label: 'Amount', control: { controlType: 'number' } }, canNode: false, defaultValue: { inputSource: 'literal', value: 1 } }];
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: {
		id: 'inline', name: 'Inline', layerType: 'inlineVisualModule', visualModule,
		clips: [], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [],
	} });
	await f.sync.flush();
	const target = { sceneId: 'scene', layerId: 'inline', target: 'module', paramPath: ['amount'] };
	const edit = value => f.manager.commit('editTimelineLayerParam', { ...target, edit: { kind: 'literal', value } }, 'arguments');
	edit(2);
	edit(3);
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'parameter', target: 'module', kind: 'value' }]);
	assert.equal(f.replica.timelineScenes[0].layers[0].visualModuleParamValues.amount.value, 3);
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(f.replica.timelineScenes[0].layers[0].visualModuleParamValues, {});
	f.manager.redo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].visualModuleParamValues.amount.value, 3);
	assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'parameter', target: 'module', kind: 'value' }]);

	f.manager.commit('editTimelineLayerParam', { ...target, edit: { kind: 'reset' } });
	edit(4);
	f.manager.commit('editTimelineLayerParam', { ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.5 } });
	f.manager.commit('updateParamAsLiteral', { sceneId: 'scene', inlineVisualModuleLayerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath, value: 0.75 });
	await f.sync.flush();
	const batch = f.batches.at(-1);
	assert.deepEqual(batch.map(change => change.type), ['node', 'layer']);
	assert.deepEqual(batch[1].changes, [
		{ type: 'parameter', target: 'module', kind: 'reset' },
		{ type: 'parameter', target: 'module', kind: 'value' },
		{ type: 'parameter', target: 'compositing', kind: 'value' },
	]);
	const replica = f.replica.timelineScenes[0].layers[0];
	assert.equal(replica.visualModule.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.75);
	assert.equal(replica.visualModuleParamValues.amount.value, 4);
	assert.equal(replica.compositingParamValues.opacity.value, 0.5);
	assert.deepEqual(f.errors, []);
});

// 【状態管理は表示名や解像度の編集も通知し、描画同期側が対象を選ぶ】
// Commandが描画の都合で通知を省略すると、状態管理が購読先に依存してしまう。
// 専用の同期経路がある変更を、この差分経路から重複送信しないことも確認する。
test('publishes state changes independently of renderer subscriptions', async t => {
	const f = fixture(t);
	const notifications = [];
	const unsubscribe = f.manager.onChange(changes => notifications.push(changes));
	f.manager.commit('renameScene', { sceneId: 'scene', name: 'Renamed' });
	f.manager.commit('changeProjectResolution', { width: 320, height: 180 });
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(notifications, [[{ type: 'sceneName', sceneId: 'scene' }], [{ type: 'projectResolution' }], [{ type: 'projectResolution' }]]);
	assert.deepEqual(f.batches, []);
	unsubscribe();
	f.manager.redo();
	assert.equal(notifications.length, 3);
});

// 【差分失敗は最新スナップショットで復旧し、旧プロジェクトの完了通知は復旧を起動しない】
// RPC失敗時の再送で古い編集を巻き戻したり、プロジェクト切替後に旧状態を送り直したりしない。
test('recovers a failed patch from current state and ignores failures after disposal', async t => {
	const gate = Promise.withResolvers();
	const f = fixture(t, 1, { apply: () => gate.promise });
	f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.5 });
	const flushed = f.sync.flush();
	gate.reject(new Error('patch rejected'));
	await flushed;
	assert.equal(f.snapshots.length, 1);
	assert.equal(f.value(), 0.5);
	const oldGate = Promise.withResolvers();
	const old = fixture(t, 1, { apply: () => oldGate.promise });
	old.manager.commit('updateParamAsLiteral', { ...old.target, value: 0.25 });
	const oldFlushed = old.sync.flush();
	old.sync.dispose();
	oldGate.reject(new Error('old worker'));
	await oldFlushed;
	assert.deepEqual(old.snapshots, []);
	assert.deepEqual(old.errors, []);
});
