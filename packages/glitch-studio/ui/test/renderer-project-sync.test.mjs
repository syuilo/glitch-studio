import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
// コマンド・履歴・差分生成は実コード。ブラウザ依存の設定とエフェクト登録だけを置き換える。
const bundle = await build({
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { ProjectContext } from './src/Project.ts';
		export { getAvailableAutomationGraphs, getTimelineScenesWithProjectAutomationGraphs } from '@gs/glitch-studio_shared/project/automation-graphs.ts';
		export { ParameterBindingEvaluator } from '@gs/shared/parameter/parameter-binding-evaluator.ts';
		export { TimelineAudioRenderer } from '@gs/subsystems_timeline_audio-renderer/timeline-audio-renderer.ts';
		export { getSceneAudioClips } from '@gs/subsystems_timeline_shared/scene-audio.ts';
		export { createProjectAutomationGraph } from './src/utility/automation-graph.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { RendererProjectSynchronizer } from './src/RendererProjectSynchronizer.ts';
		export { applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export { default as definition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { createInlineVisualModuleLayer } from './src/utility/inline-visual-module-layer.ts';
		export { createCameraTimelineLayer } from './src/utility/camera-timeline-layer.ts';
		export { createImageLayer } from './src/utility/image-layer.ts';
	` },
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'sync-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$|preferences\.ts$/ }, args => ({ path: args.path, namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };",
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', 'console', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports, { ...console, log() {} });
const { ProjectContext, RendererProjectSynchronizer, applyRendererProjectChanges, definition,
	createEffectTimelineLayer, createInlineVisualModuleLayer, createImageLayer, createCameraTimelineLayer } = module.exports;

function fixture(t, count = 1, overrides = {}) {
	const manager = new ProjectContext().stateManager;
	const nodes = Array.from({ length: count }, (_, i) => ({
		id: 'node-' + i, type: 'effect', effectId: definition.id, pos: { x: 0, y: 0 }, isBypass: false, resolution: { mode: 'auto' },
		params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])),
	}));
	const visualModule = { id: 'module', name: 'Module', nodes, paramDefs: [], outputDefs: [], primaryInputId: null, primaryOutputId: null, automationGraphs: [] };
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	manager.state.visualModules.value = [visualModule];
	manager.state.timelineScenes.value = [scene];
	let replica = structuredClone({ automationGraphs: [], visualModules: [visualModule], timelineScenes: [scene] });
	const batches = [], errors = [];
	const sync = new RendererProjectSynchronizer(manager, {
		apply: async changes => { batches.push(changes); replica = applyRendererProjectChanges(replica, changes); },
		onUpdated() {}, onError: error => errors.push(error), ...overrides,
	});
	t.after(() => sync.dispose());
	const target = { visualModuleId: 'module', nodeId: 'node-0', paramPath: ['buzzs', 'first', 'x'] };
	const value = state => state.visualModules[0].nodes[0].params.buzzs.value[0].binding.value.x.value;
	return { manager, sync, target, batches, errors, value: () => value(replica), get replica() { return replica; } };
}

// 【ブラー無効化をレイヤー差分として同期し、Undo・Redoでも子の保存値を変更しない】
// グループの配下への適用は描画時の規則であり、子のbooleanを書き換えるとグループ解除や
// 別配置で元の設定へ戻れない。音声レイヤーには映像専用の設定を持ち込まない。
test('synchronizes motion blur overrides through undo and redo without mutating descendants', async t => {
	const f = fixture(t);
	f.manager.state.assets.value = [{ id: 'asset', name: 'Image', fileDataType: 'image/png', fileData: new Blob([], { type: 'image/png' }) }];
	const child = createImageLayer('asset', 0);
	assert.equal(child.forceDisableMotionBlur, false);
	const group = { id: 'group', name: 'Group', layerType: 'group', layers: [child], isDisabled: false,
		forceDisableMotionBlur: false, automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: child });
	f.manager.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: [child.id], group: { ...group, layers: [] } });
	await f.sync.flush();
	for (const layerId of [child.id, group.id]) {
		f.manager.commit('setTimelineLayerMotionBlurDisabled', { sceneId: 'scene', layerId, forceDisableMotionBlur: true });
		await f.sync.flush();
		assert.deepEqual(f.batches.at(-1)[0].changes, [{ type: 'motionBlur' }]);
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, true);
		f.manager.undo();
		await f.sync.flush();
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, false);
		f.manager.redo();
		await f.sync.flush();
		assert.equal(f.batches.at(-1)[0].layer.forceDisableMotionBlur, true);
		f.manager.undo();
		await f.sync.flush();
	}
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].layers[0].forceDisableMotionBlur, false);
	f.manager.state.timelineScenes.value[0].layers.push({ id: 'audio', layerType: 'audio' });
	assert.throws(() => f.manager.commit('setTimelineLayerMotionBlurDisabled', { sceneId: 'scene', layerId: 'audio', forceDisableMotionBlur: true }), /visual layer/);
	assert.deepEqual(f.errors, []);
});

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

// 【レイヤー生成関数は表示状態で作成し、コピー元に依存しない】
// 必須のisDisabledが未設定だとUIと保存データの状態が曖昧になるため、新規作成時にfalseを保存する。
test('creates image effect and inline visual module layers enabled by default', () => {
	for (const layer of [createImageLayer('asset', 100), createEffectTimelineLayer(definition, 100), createInlineVisualModuleLayer(100)]) {
		assert.equal(layer.isDisabled, false);
	}
});

// 【全種類のレイヤーの表示切り替えを対象だけへ同期し、Undo/Redoでも同じ変更を通知する】
// 状態を直接書き換えると履歴やWorker側の表示が追従しない。別Sceneに同じレイヤーIDがあっても
// 影響せず、クリップ・引数・キーは表示切り替えの前後で保持する必要がある。
test('synchronizes visibility for every layer type through undo and redo with scene-local targeting', async t => {
	const f = fixture(t);
	const base = { id: 'layer', name: 'Layer', isDisabled: false, clips: [], automationGraphs: [] };
	const compositing = { compositingParamValues: {} };
	const audio = { audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const layers = [
		{ ...base, ...compositing, layerType: 'image' },
		{ ...base, ...compositing, ...audio, layerType: 'video' },
		{ ...base, ...audio, layerType: 'audio' },
		{ ...base, ...compositing, ...audio, layerType: 'scene' },
		{ ...base, ...compositing, layerType: 'visualModule', visualModuleId: 'module', visualModuleParamValues: {} },
		{ ...createInlineVisualModuleLayer(100), id: base.id },
		{ ...createEffectTimelineLayer(definition, 100), id: base.id },
	];
	f.manager.commit('addScene', { id: 'other', name: 'Other', resolution: { mode: 'project' }, layers: [layers[0]] });
	await f.sync.flush();
	for (const original of layers) {
		f.manager.state.timelineScenes.value[0].layers = [structuredClone(original)];
		const target = { sceneId: 'scene', layerId: 'layer' };
		for (const isDisabled of [true, false]) {
			f.manager.commit('setTimelineLayerDisabled', { ...target, isDisabled });
			await f.sync.flush();
			assert.equal(f.batches.at(-1).length, 1);
			assert.deepEqual(f.batches.at(-1)[0], { type: 'layer', ...target, changes: [{ type: 'disabled' }], layer: { ...original, isDisabled } });
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled });
			f.manager.undo();
			await f.sync.flush();
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled: !isDisabled });
			f.manager.redo();
			await f.sync.flush();
			assert.deepEqual(f.replica.timelineScenes[0].layers[0], { ...original, isDisabled });
			assert.equal(f.replica.timelineScenes[1].layers[0].isDisabled, false);
		}
	}
	assert.deepEqual(f.errors, []);
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

const group = (id, layers = []) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, automationGraphs: [],
	compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } });

// 【階層変更と同時の子の編集を保持し、削除された子への差分は送らない】
// Scene全体の置換に吸収すると、無関係の履歴まで破棄するか、保持すべきでない履歴を残してしまう。
// グループのUndoで復活するインライン定義にも編集済みの値が含まれる必要がある。
test('retains inline edit metadata across reparenting and restores edited deleted groups on undo', async t => {
	const f = fixture(t);
	const inline = { ...createInlineVisualModuleLayer(0), id: 'inline', visualModule: structuredClone(f.replica.visualModules[0]) };
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: group('group', [inline]) });
	await f.sync.flush();
	const edit = value => f.manager.commit('updateParamAsLiteral', { sceneId: 'scene', inlineVisualModuleLayerId: 'inline', nodeId: 'node-0', paramPath: f.target.paramPath, value });
	edit(0.4);
	f.manager.commit('moveTimelineLayer', { sceneId: 'scene', layerId: 'inline', parentId: null, beforeId: null });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layerTree', 'node']);
	assert.deepEqual(f.batches.at(-1)[1].changes, [{ type: 'parameter', kind: 'value' }]);
	assert.equal(f.replica.timelineScenes[0].layers[1].visualModule.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.4);
	f.manager.undo();
	await f.sync.flush();
	edit(0.8);
	f.manager.commit('removeTimelineLayer', { sceneId: 'scene', layerId: 'group' });
	await f.sync.flush();
	assert.deepEqual(f.batches.at(-1).map(change => change.type), ['layerTree']);
	assert.deepEqual(f.replica.timelineScenes[0].layers, []);
	f.manager.undo();
	await f.sync.flush();
	assert.equal(f.replica.timelineScenes[0].layers[0].layers[0].visualModule.nodes[0].params.buzzs.value[0].binding.value.x.value, 0.8);
	assert.deepEqual(f.errors, []);
});

// 【入れ子のグループ移動は各レイヤーの設定を一度だけ送る】
// 親ごとに全子孫を複製すると深さに応じて送信量が二乗で増え、ドラッグのたびに遅延する。
// Undo/Redoでも子の配置を失わず、クリップ移動などの変更種別を個別に保持する。
test('sends each layer once without nested snapshots when moving a deep group', async t => {
	const f = fixture(t);
	let root = { ...createEffectTimelineLayer(definition, 1000), id: 'effect' };
	for (let index = 0; index < 8; index++) root = group('group-' + index, [root]);
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: root });
	await f.sync.flush();
	const before = structuredClone(f.replica);
	f.manager.commit('moveTimelineContainer', { sceneId: 'scene', layerId: root.id, deltaMs: 100 });
	await f.sync.flush();
	const after = structuredClone(f.replica);
	const assertBatch = () => {
		const batch = f.batches.at(-1);
		assert.equal(batch.length, 9);
		assert.equal(new Set(batch.map(change => change.layerId)).size, 9);
		for (const change of batch) {
			assert.equal(change.type, 'layer');
			assert.equal('layers' in change.layer, false);
			if (change.layer.layerType === 'group') assert.ok(change.changes.every(edit => edit.type === 'parameter'));
			else assert.ok(change.changes.some(edit => edit.type === 'clips'));
		}
	};
	assertBatch();
	f.manager.undo();
	await f.sync.flush();
	assertBatch();
	assert.deepEqual(f.replica, before);
	f.manager.redo();
	await f.sync.flush();
	assertBatch();
	assert.deepEqual(f.replica, after);
	assert.deepEqual(f.errors, []);
});

// 【Module引数の履歴と、同時に編集したノード・合成設定の変更内容を通知する】
// 同じレイヤーだからと最後の編集種別だけ残すと、合成設定やリセットが通常の値編集に
// 化けてしまう。Inline Moduleの部分編集も吸収せず、レンダラーが判断する材料を保つ。
test('retains layer edit kinds through merged history and simultaneous inline edits', async t => {
	const f = fixture(t);
	const visualModule = structuredClone(f.replica.visualModules[0]);
	visualModule.paramDefs = [{ id: 'amount', nameForReference: 'amount', dataType: { kind: 'scalar' },
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

// 【Visual Moduleの名前変更は履歴に残し、ノードや描画インスタンスへ影響させない】
// 表示名の変更を登録変更として送ると、名前を入力するだけでVisual Module Live Previewや履歴を持つエフェクトが再初期化される。
// 登録済みはVisual Module自身、インラインはレイヤーの名前を変更し、Undo/Redoでも同じIDと構成を維持する。
test('renames registered and inline Visual Modules through history without renderer patches', async t => {
	const f = fixture(t);
	const registeredVisualModule = f.manager.state.visualModules.value[0];
	const originalName = registeredVisualModule.name;
	const originalNodes = registeredVisualModule.nodes;
	const inlineLayer = createInlineVisualModuleLayer(0);
	const originalLayerName = inlineLayer.name;
	f.manager.state.timelineScenes.value[0].layers.push(inlineLayer);
	const notifications = [];
	f.manager.onChange(changes => notifications.push(changes));
	f.manager.commit('renameVisualModule', { visualModuleId: registeredVisualModule.id, name: 'Renamed Visual Module' });
	f.manager.commit('renameTimelineLayer', { sceneId: 'scene', layerId: inlineLayer.id, name: 'Renamed Inline Visual Module' });
	await f.sync.flush();
	assert.equal(registeredVisualModule.name, 'Renamed Visual Module');
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, 'Renamed Inline Visual Module');
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	f.manager.undo();
	assert.equal(registeredVisualModule.name, originalName);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, originalLayerName);
	f.manager.redo();
	f.manager.redo();
	await f.sync.flush();
	assert.equal(registeredVisualModule.name, 'Renamed Visual Module');
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].name, 'Renamed Inline Visual Module');
	assert.equal(registeredVisualModule.id, 'module');
	assert.equal(registeredVisualModule.nodes, originalNodes);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].id, inlineLayer.id);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].visualModule.name, undefined);
	const registeredNameChange = [{ type: 'visualModuleName', visualModuleId: 'module' }];
	const inlineNameChange = [{ type: 'layerName', sceneId: 'scene', layerId: inlineLayer.id }];
	assert.deepEqual(notifications, [registeredNameChange, inlineNameChange, inlineNameChange, registeredNameChange, registeredNameChange, inlineNameChange]);
	assert.deepEqual(f.batches, []);
	assert.deepEqual(f.errors, []);
});

// 【差分失敗は所有者へ通知し、全量再送や成功通知を行わない】
// 失敗後のエンジン破棄・再生成はPreviewRenderEngineが担当する。
// Synchronizerが独自に再同期すると、停止状態や旧プロジェクトの処理を復活させてしまう。
test('reports failed patches without resynchronizing and ignores failures after disposal', async t => {
	const gate = Promise.withResolvers();
	let updated = 0;
	const f = fixture(t, 1, { apply: () => gate.promise, onUpdated: () => { updated++; } });
	f.manager.commit('updateParamAsLiteral', { ...f.target, value: 0.5 });
	const flushed = f.sync.flush();
	gate.reject(new Error('patch rejected'));
	await flushed;
	assert.equal(f.errors.length, 1);
	assert.equal(f.errors[0].message, 'patch rejected');
	assert.equal(f.value(), 0);
	assert.equal(updated, 0);
	const oldGate = Promise.withResolvers();
	const old = fixture(t, 1, { apply: () => oldGate.promise });
	old.manager.commit('updateParamAsLiteral', { ...old.target, value: 0.25 });
	const oldFlushed = old.sync.flush();
	old.sync.dispose();
	oldGate.reject(new Error('old worker'));
	await oldFlushed;
	assert.deepEqual(old.errors, []);
});

// 【カメラの編集・Undo・Redoを通常のレイヤー差分として同期する】
// カメラだけの編集でScene全体を置換すると、他レイヤーの動画・履歴が再生成される。
// 既存の差分経路に統合し、映像レイヤーの参照を維持することを確認する。
test('synchronizes camera layer edits and undo without replacing other layers', async t => {
	const f = fixture(t);
	const camera = createCameraTimelineLayer(0);
	const image = createInlineVisualModuleLayer(0);
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: image });
	f.manager.commit('addTimelineLayer', { sceneId: 'scene', layer: camera });
	await f.sync.flush();
	const originalImage = f.replica.timelineScenes[0].layers.find(layer => layer.id === image.id);
	const target = { sceneId: 'scene', layerId: camera.id, target: 'camera' };
	f.manager.commit('editTimelineLayerParam', { ...target, paramPath: ['position'], edit: { kind: 'literal', value: [0.4, 0.2] } });
	f.manager.commit('editTimelineLayerParam', { ...target, paramPath: ['z'], edit: { kind: 'expression', value: 'TIME + 3' } });
	await f.sync.flush();
	const values = () => f.replica.timelineScenes[0].layers.find(layer => layer.id === camera.id).cameraParamValues;
	assert.equal(f.batches.at(-1).length, 1);
	assert.equal(f.batches.at(-1)[0].type, 'layer');
	assert.equal(values().z.expression, 'TIME + 3');
	f.manager.undo(); await f.sync.flush();
	assert.deepEqual(values().z, camera.cameraParamValues.z);
	f.manager.undo(); await f.sync.flush();
	assert.deepEqual(values().position.value, [0, 0]);
	f.manager.redo(); f.manager.redo(); await f.sync.flush();
	assert.deepEqual(values().position.value, [0.4, 0.2]);
	assert.equal(f.replica.timelineScenes[0].layers.find(layer => layer.id === image.id), originalImage);
	assert.deepEqual(f.errors, []);
});

const { getAvailableAutomationGraphs, getTimelineScenesWithProjectAutomationGraphs, ParameterBindingEvaluator,
	TimelineAudioRenderer, getSceneAudioClips, createProjectAutomationGraph, encodeProjectFile, decodeProjectFile } = module.exports;
const sharedGraph = (id = 'shared', nameForReference = 'Curve', value = null) => ({ id, nameForReference, isNormalized: false,
	points: [0, 1000].map((x, index) => ({ id: id + index, x, y: value ?? index, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] })),
});
const graphReference = id => ({ inputSource: 'automationGraphReference', automationGraphId: id, trimmedDurationMs: null, wrapMode: 'clamp', offsetMode: 'start' });

// 【共通定義の編集・削除・Undo/Redoと同期・保存は、参照元のIDを維持する】
// 削除時にBindingをnullへ書き換えるとUndoで再接続できない。曲線変更も最新の定義を送り、
// 名前変更後のID参照と保存ファイル内の定義が食い違わないことを確認する。
test('synchronizes and saves shared graphs through editing deletion undo and redo', async t => {
	const f = fixture(t);
	const graph = sharedGraph();
	const layer = createImageLayer('asset', 0);
	layer.compositingParamValues.opacity = graphReference(graph.id);
	f.manager.state.timelineScenes.value[0].layers.push(layer);
	f.manager.commit('addProjectAutomationGraph', { automationGraph: graph });
	await f.sync.flush();
	assert.deepEqual(f.replica.automationGraphs, [graph]);
	const renamed = { ...graph, nameForReference: 'Renamed', points: graph.points.map(point => ({ ...point, y: 0.25 })) };
	f.manager.commit('updateProjectAutomationGraph', { automationGraph: renamed });
	await f.sync.flush();
	assert.deepEqual(f.replica.automationGraphs, [renamed]);
	const decoded = decodeProjectFile(await encodeProjectFile({ automationGraphs: f.manager.state.automationGraphs.value,
		assets: [], generatedSpeech: [], visualModules: [], timelineScenes: f.manager.state.timelineScenes.value }));
	assert.deepEqual(decoded.automationGraphs, [renamed]);
	assert.equal(decoded.timelineScenes[0].layers[0].compositingParamValues.opacity.automationGraphId, graph.id);
	f.manager.commit('removeProjectAutomationGraph', { automationGraphId: graph.id });
	await f.sync.flush();
	assert.deepEqual(f.replica.automationGraphs, []);
	assert.equal(f.manager.state.timelineScenes.value[0].layers[0].compositingParamValues.opacity.automationGraphId, graph.id);
	f.manager.undo();
	await f.sync.flush();
	assert.deepEqual(f.replica.automationGraphs, [renamed]);
	f.manager.redo();
	await f.sync.flush();
	assert.deepEqual(f.replica.automationGraphs, []);
});

// 【共通定義の参照名はプロジェクト内で一意にし、複製では曲線とIDを独立させる】
// GRAPH()の解決を登録順に依存させず、失敗したコマンドで一覧の一部だけが変更されないようにする。
test('validates shared graph names and duplicates independent curves and identities', t => {
	const f = fixture(t);
	const graph = sharedGraph();
	f.manager.commit('addProjectAutomationGraph', { automationGraph: graph });
	for (const invalid of [{ ...graph, id: 'other' }, { ...graph, id: 'empty', nameForReference: '  ' }]) {
		assert.throws(() => f.manager.commit('addProjectAutomationGraph', { automationGraph: invalid }));
	}
	const copy = createProjectAutomationGraph(f.manager.state.automationGraphs.value, graph);
	assert.notEqual(copy.id, graph.id);
	assert.notEqual(copy.nameForReference, graph.nameForReference);
	assert.notEqual(copy.points[0].id, graph.points[0].id);
	copy.points[0].y = 100;
	assert.equal(graph.points[0].y, 0);
	f.manager.commit('addProjectAutomationGraph', { automationGraph: copy });
	assert.throws(() => f.manager.commit('updateProjectAutomationGraph', { automationGraph: { ...copy, nameForReference: graph.nameForReference } }));
	assert.equal(f.manager.state.automationGraphs.value[1].nameForReference, copy.nameForReference);
});

// 【名前参照はローカル優先でも、ID参照は同名の共通定義を選べる】
// 名前の上書きで共通定義自体を候補から除くと、選択済みのID参照まで失われてしまう。
// 曲線の保存場所に時計を持たせず、参照元の時刻が評価値を決めることも確認する。
test('prefers local names while resolving shared IDs using the caller clock', () => {
	const definition = { dataType: { kind: 'scalar' }, ui: { label: 'Value' } };
	const evaluator = new ParameterBindingEvaluator();
	const global = sharedGraph();
	const local = sharedGraph('local', global.nameForReference, 0.75);
	const scope = { automationGraphs: getAvailableAutomationGraphs([local], [global]), time: 200, endTime: Infinity, variables: {} };
	assert.equal(evaluator.evaluate({ inputSource: 'expression', expression: 'GRAPH("Curve", 200, "clamp")' }, scope, -1, definition), 0.75);
	assert.equal(evaluator.evaluate(graphReference(local.id), scope, -1, definition), 0.75);
	assert.ok(Math.abs(evaluator.evaluate(graphReference(global.id), scope, -1, definition) - 0.2) < 1e-8);
	assert.ok(Math.abs(evaluator.evaluate(graphReference(global.id), { ...scope, time: 800 }, -1, definition) - 0.8) < 1e-8);
	assert.equal(evaluator.evaluate(graphReference('deleted'), scope, 0.4, definition), 0.4);
});

// 【グループ内でも参照元レイヤーだけのローカル定義を使い、Visual Module内部へ公開しない】
// 評価用のSceneを組み立てる際に保存状態を変更すると、共有定義がレイヤーやVisual Moduleへ
// コピーされ、編集の二重管理や持ち出し時の意図しない依存が生じる。
test('composes timeline evaluation graphs without mutating saved layers or Visual Module internals', () => {
	const global = sharedGraph();
	const child = { id: 'child', layerType: 'inlineVisualModule', automationGraphs: [], visualModule: { automationGraphs: [] } };
	const group = { id: 'group', layerType: 'group', automationGraphs: [sharedGraph('parent')], layers: [child] };
	const scenes = [{ id: 'scene', layers: [group] }];
	const [evaluated] = getTimelineScenesWithProjectAutomationGraphs(scenes, [global]);
	assert.deepEqual(evaluated.layers[0].automationGraphs.map(graph => graph.id), ['parent', 'shared']);
	assert.deepEqual(evaluated.layers[0].layers[0].automationGraphs.map(graph => graph.id), ['shared']);
	assert.equal(evaluated.layers[0].layers[0].visualModule, child.visualModule);
	assert.deepEqual(child.visualModule.automationGraphs, []);
	assert.deepEqual(child.automationGraphs, []);
	assert.deepEqual(group.automationGraphs.map(graph => graph.id), ['parent']);
});

// 【音量も映像と同じ候補を使い、子Sceneの配置ではそのSceneの時計で評価する】
// 最上位の時刻だけで共通グラフを一度評価すると、子Sceneのトリムや配置位置で音量がずれる。
// 実際の音声計画とミキサーを通して、プレビュー・書き出し両方のPCMを確認する。
test('evaluates shared audio gain in nested scene time during preview and export', async () => {
	const graph = sharedGraph();
	const audioLayer = { id: 'audio', layerType: 'audio', isDisabled: false, automationGraphs: [],
		audioParamValues: { volume: graphReference(graph.id) }, clips: [{ id: 'audio-clip', assetId: 'sound',
			startMs: 0, sourceInMs: 0, sourceOutMs: 1000, playbackRate: 1, loop: false, durationMs: 1000 }] };
	const sceneLayer = { id: 'nested', layerType: 'scene', isDisabled: false, automationGraphs: [], audioParamValues: { volume: { inputSource: 'literal', value: 1 } },
		clips: [{ id: 'nested-clip', sceneId: 'child', startMs: 1000, contentOffsetMs: 200, durationMs: 500 }] };
	const scenes = getTimelineScenesWithProjectAutomationGraphs([{ id: 'root', layers: [sceneLayer] }, { id: 'child', layers: [audioLayer] }], [graph]);
	const clips = getSceneAudioClips(scenes, 'root');
	assert.equal(clips.length, 1);
	const renderer = new TimelineAudioRenderer(async (_source, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(1)]);
	for (const isExport of [false, true]) {
		const pcm = await renderer.renderClips(clips, 1000, 1, 1000, isExport);
		assert.ok(Math.abs(pcm[0][0] - 0.2) < 1e-6);
	}
});
