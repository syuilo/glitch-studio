import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// GPU・ストレージに依存する登録情報だけ差し替え、実際のコマンドとパラメータ解決を使う。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export { timelineCompositingParamDefs } from '../shared/src/timeline/timeline-compositing.ts'; export { COMMAND_DEFS } from './src/commands.ts'; export { createInlineAutomationGraph, setInlineAutomationGraphNormalized } from './src/utility/automation-graph.ts'; export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)),
		loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{
		name: 'inline-graph-test-dependencies',
		setup(build) {
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'inline-graph-test' }));
			build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'inline-graph-test' }));
			build.onLoad({ filter: /.*/, namespace: 'inline-graph-test' }, ({ path }) => ({
				contents: path === 'preferences'
					? 'export const preferences = { s: { forceTypeSafety: false } };'
					: `export const effectDefinitions = { test: { paramDefs: {
						values: { dataType: { kind: 'array', elementType: { kind: 'scalar' } }, ui: { label: 'Values', control: { element: { controlType: 'number' } } }, element: { defaultValue: { inputSource: 'literal', value: 0 } }, defaultValue: { inputSource: 'literal', value: [] } }
					} } };`,
				loader: 'ts',
			}));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { timelineCompositingParamDefs, COMMAND_DEFS, createInlineAutomationGraph, setInlineAutomationGraphNormalized, encodeProjectFile, decodeProjectFile } = module.exports;

const defaultCompositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));

// 【動画レイヤーのトリム・映像・音声を保存と履歴で独立して復元する】
// 音声無効化が配置長や音量キーを変更しないこと、範囲外トリムが状態を壊さないことも確認する。
test('round-trips video settings and undoes trimmed timing and independent audio controls', async () => {
	const { state } = fixture();
	const layer = { id: 'video', layerType: 'video', assetId: 'movie', positionMs: 8000, trimStartMs: 2000, trimmedDurationMs: 5000,
		audioEnabled: true, compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	const target = { sceneId: 'scene', layerId: 'video' };
	const add = COMMAND_DEFS.addVideoLayer.create({ sceneId: 'scene', layer, sourceDurationMs: 10000 });
	add.execute(state);
	const settings = COMMAND_DEFS.editVideoLayerSettings.create({ ...target, audioEnabled: false });
	const fit = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'compositing', paramId: 'fitMode', edit: { kind: 'literal', value: 'cover' } });
	const volume = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'audio', paramId: 'volume', edit: { kind: 'expression', value: 'PROGRESS' } });
	const timing = COMMAND_DEFS.editVideoLayerTiming.create({ ...target, positionMs: -1000, trimStartMs: 2000, trimmedDurationMs: 6000, sourceDurationMs: 10000 });
	for (const command of [settings, fit, volume, timing]) command.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video').compositingParamValues.fitMode, { inputSource: 'literal', value: 'cover' });
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const encoded = await encodeProjectFile({ gsVersion: '2.0.0', assets: [], timelineScenes: state.timelineScenes.value });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	assert.throws(() => COMMAND_DEFS.editVideoLayerTiming.create({ ...target, positionMs: 0, trimStartMs: 9000, trimmedDurationMs: 2000, sourceDurationMs: 10000 }).execute(state), /Invalid video layer timing/);
	assert.deepEqual(state.timelineScenes.value[0].layers, before);
	for (const command of [timing, volume, fit, settings]) command.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video'), layer);
	add.undo(state);
	add.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video'), layer);
});

// 【音声レイヤーの編集と保存を既存の履歴へ統合する】
// 音量Bindingと素材位置を別々にUndoでき、保存後もPlayerへの依存を持ち込まない。
test('round-trips audio layers and undoes timing, volume and removal', async () => {
	const { state } = fixture();
	const layer = { id: 'audio', layerType: 'audio', assetId: 'sound', positionMs: 100, trimmedDurationMs: 1000, trimStartMs: 50,
		paramValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	const add = COMMAND_DEFS.addAudioLayer.create({ sceneId: 'scene', layer });
	add.execute(state);
	const volume = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: 'audio', target: 'audio', paramId: 'volume', edit: { kind: 'expression', value: 'PROGRESS' } });
	volume.execute(state);
	const timing = COMMAND_DEFS.editAudioLayerTiming.create({ sceneId: 'scene', layerId: 'audio', positionMs: 200, trimmedDurationMs: 1000, trimStartMs: 50 });
	timing.execute(state);
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const remove = COMMAND_DEFS.removeTimelineLayer.create({ sceneId: 'scene', layerId: 'audio' });
	remove.execute(state);
	remove.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers, before);
	const encoded = await encodeProjectFile({ gsVersion: '2.0.0', assets: [], timelineScenes: [{ id: 'scene', name: 'Scene', layers: state.timelineScenes.value[0].layers }] });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	timing.undo(state);
	volume.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
	add.undo(state);
	assert.equal(state.timelineScenes.value[0].layers.some(entry => entry.id === 'audio'), false);
	add.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
});

// 合成設定の履歴はモジュールパラメータと独立し、保存された初期値まで復元する。
test('undoes and redoes compositing expressions without changing module parameters', () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	layer.paramValues.opacity = { inputSource: 'literal', value: 0.8 };
	const command = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene',
		layerId: layer.id, target: 'compositing', paramId: 'opacity', edit: { kind: 'expression', value: 'PROGRESS' },
	});
	command.execute(state);
	assert.deepEqual(layer.compositingParamValues.opacity, { inputSource: 'expression', expression: 'PROGRESS' });
	command.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	command.execute(state);
	assert.equal(layer.compositingParamValues.opacity.expression, 'PROGRESS');
	assert.equal(layer.paramValues.opacity.value, 0.8);
});

// inlineグラフの編集データをコピーし、保存・読み込み後にも参照グラフや合成方法を保持する。
// プロジェクト保存はAssetのBlobをバイト列へ変換する非同期処理なので、素材がなくても完了を待つ。
// 保存前のオブジェクト比較だけでは、再読み込み時にグラフや合成設定が欠落する不具合を検出できない。
test('preserves compositing graphs and settings through edits and serialization', async () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	const edit = (paramId, edit) => {
		const command = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: layer.id, target: 'compositing', paramId, edit });
		command.execute(state);
		return command;
	};
	const input = createInlineAutomationGraph();
	input.automationGraph.points[0].y = 0.25;
	layer.automationGraphs.push({ id: 'graph', name: 'Layer graph', ...structuredClone(input.automationGraph) });
	const inline = edit('opacity', { kind: 'automationGraphInline', value: input });
	input.automationGraph.points[0].y = 99;
	assert.equal(layer.compositingParamValues.opacity.automationGraph.points[0].y, 0.25);
	inline.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	inline.execute(state);
	edit('rotation', { kind: 'automationGraphReference', value: 'graph', options: { trimmedDurationMs: 2500, offsetMode: 'end', wrapMode: 'clamp' } });
	edit('blendMode', { kind: 'literal', value: 'replace' });
	const restored = decodeProjectFile(await encodeProjectFile({ timelineScenes: [{ id: 'scene', name: 'Scene', layers: [layer] }], assets: [] })).timelineScenes[0].layers[0];
	assert.deepEqual(restored.compositingParamValues, layer.compositingParamValues);
	assert.deepEqual(restored.automationGraphs, layer.automationGraphs);
	assert.equal(restored.compositingParamValues.rotation.trimmedDurationMs, 2500);
	const reset = edit('blendMode', { kind: 'reset' });
	assert.equal(layer.compositingParamValues.blendMode.value, 'normal');
	reset.undo(state);
	assert.equal(layer.compositingParamValues.blendMode.value, 'replace');
});

// 単位切り替えはXと制御点のXだけを変換し、曲線の形・Y・元データを維持する。
test('converts inline graph coordinates between normalized and millisecond units', () => {
	const original = createInlineAutomationGraph();
	original.trimmedDurationMs = 2500;
	const ms = setInlineAutomationGraphNormalized(original, false);
	assert.equal(ms.automationGraph.isNormalized, false);
	assert.deepEqual(ms.automationGraph.points.map(point => point.x), [0, 2500]);
	assert.deepEqual(ms.automationGraph.points[0].bezierControlPointB, [1250, 0]);
	assert.deepEqual(ms.automationGraph.points[1].bezierControlPointA, [-1250, 0]);
	assert.deepEqual(setInlineAutomationGraphNormalized(ms, true), original);
	assert.deepEqual(original.automationGraph.points.map(point => point.x), [0, 1]);
	// msグラフの開始時刻が0以外でも、実際の区間を正規化する。
	for (const point of ms.automationGraph.points) point.x += 500;
	const normalized = setInlineAutomationGraphNormalized(ms, true);
	assert.equal(normalized.trimmedDurationMs, 2500);
	assert.deepEqual(normalized.automationGraph.points.map(point => point.x), [0, 1]);
});

// 空・1点のグラフから切り替えても、編集可能な固定端点と有限の座標を用意する。
test('provides normalized endpoints for empty and single-point inline graphs', () => {
	for (const empty of [true, false]) {
		const input = createInlineAutomationGraph();
		input.automationGraph.isNormalized = false;
		input.automationGraph.points = empty ? [] : [{ ...input.automationGraph.points[0], x: 300, y: 4 }];
		const result = setInlineAutomationGraphNormalized(input, true);
		assert.deepEqual(result.automationGraph.points.map(point => [point.x, point.y]), empty ? [[0, 0], [1, 0]] : [[0, 4], [1, 4]]);
	}
});

function fixture() {
	const initial = { inputSource: 'literal', value: 3 };
	const node = { id: 'node', type: 'effect', resolution: { mode: 'project' }, effectId: 'test', params: { values: { inputSource: 'literal', value: [initial] } } };
	const state = {
		visualModules: { value: [{ id: 'module', nodes: [node], primaryInputId: null, paramDefs: [{ id: 'gain', defaultValue: initial }] }] },
		timelineScenes: { value: [{ id: 'scene', name: 'Scene', layers: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', positionMs: 0, trimStartMs: 0, trimmedDurationMs: 1000, paramValues: {}, compositingParamValues: defaultCompositing(), automationGraphs: [] }] }] },
	};
	return { state, node, target: { visualModuleId: 'module', nodeId: 'node', paramPath: ['values', 0] } };
}

// inlineへの切り替えをUndoでき、RedoでポイントのIDも再現する。
test('restores inline graph creation in nested node parameters', () => {
	const { state, node, target } = fixture();
	const command = COMMAND_DEFS.changeParamValueInputSource.create({ ...target, inputSource: 'automationGraphInline' });
	command.execute(state);
	const created = structuredClone(node.params.values.value[0]);
	assert.equal(created.inputSource, 'automationGraphInline');
	assert.equal(created.automationGraph.isNormalized, true);
	assert.deepEqual(created.automationGraph.points.map(point => point.x), [0, 1]);
	command.undo(state);
	assert.deepEqual(node.params.values.value[0], { inputSource: 'literal', value: 3 });
	command.execute(state);
	assert.deepEqual(node.params.values.value[0], created);
});

// AppContextは結合時に最初のundoと最後のexecuteを保持する。その契約で全ドラッグを復元できる。
test('restores the first and final snapshots of a merged graph drag', () => {
	const { state, node, target } = fixture();
	COMMAND_DEFS.changeParamValueInputSource.create({ ...target, inputSource: 'automationGraphInline' }).execute(state);
	const before = structuredClone(node.params.values.value[0]);
	const intermediate = structuredClone(before);
	intermediate.automationGraph.points[0].y = 2;
	const first = COMMAND_DEFS.updateParamAsAutomationGraphInline.create({ ...target, value: intermediate });
	first.execute(state);
	const final = structuredClone(intermediate);
	final.automationGraph.points[0].y = 4;
	final.automationGraph.points[1].bezierControlPointA = [-0.25, 2];
	const last = COMMAND_DEFS.updateParamAsAutomationGraphInline.create({ ...target, value: final });
	last.execute(state);
	// エディタが次に可変配列を編集しても、履歴のスナップショットは変わらない。
	intermediate.automationGraph.points[0].y = 99;
	node.params.values.value[0].automationGraph.points[0].y = 100;
	first.undo(state);
	assert.deepEqual(node.params.values.value[0], before);
	last.execute(state);
	assert.deepEqual(node.params.values.value[0], final);
});

// レイヤーの設定変更もUndo/Redoでき、切り替え前の「既定値参照」へ戻せる。
test('undoes inline graph edits and creation on timeline layers', () => {
	const { state } = fixture();
	const target = { layerId: 'layer', paramId: 'gain' };
	const layer = state.timelineScenes.value[0].layers[0];
	const create = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', ...target, edit: { kind: 'inputSource', inputSource: 'automationGraphInline' } });
	create.execute(state);
	const before = structuredClone(layer.paramValues.gain);
	const after = structuredClone(before);
	after.automationGraph.isNormalized = false;
	after.trimmedDurationMs = 2500;
	after.wrapMode = 'repeatMirrored';
	after.offsetMode = 'end';
	after.automationGraph.points[0].y = -2;
	const edit = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', ...target, edit: { kind: 'automationGraphInline', value: after } });
	edit.execute(state);
	assert.deepEqual(layer.paramValues.gain, after);
	edit.undo(state);
	assert.deepEqual(layer.paramValues.gain, before);
	create.undo(state);
	assert.equal(Object.hasOwn(layer.paramValues, 'gain'), false);
	create.execute(state);
	edit.execute(state);
	assert.deepEqual(layer.paramValues.gain, after);
});

// 【Sceneを切り替えてもレイヤー編集のUndoは元の定義へ戻る】
// 同じレイヤーIDが別Sceneに存在しても、編集対象をsceneIdと組み合わせて一意に指定する。
test('targets scene definitions explicitly across layer parameter undo and redo', () => {
	const { state } = fixture();
	const original = state.timelineScenes.value[0];
	const other = structuredClone(original);
	other.id = 'other';
	state.timelineScenes.value.push(other);
	const edit = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: 'layer', target: 'compositing', paramId: 'opacity', edit: { kind: 'literal', value: 0.25 } });
	edit.execute(state);
	assert.equal(original.layers[0].compositingParamValues.opacity.value, 0.25);
	assert.equal(other.layers[0].compositingParamValues.opacity.value, 1);
	edit.undo(state);
	assert.equal(original.layers[0].compositingParamValues.opacity.value, 1);
	edit.execute(state);
	assert.equal(other.layers[0].compositingParamValues.opacity.value, 1);
});

// 【参照中Sceneの削除と循環する配置を状態変更前に拒否する】
// 失敗したCommandが部分的な変更を残すと、Undo履歴へ積まれない壊れた参照が保存されてしまう。
test('rejects referenced deletion and cyclic placement without mutating scenes', () => {
	const { state } = fixture();
	const nested = { id: 'nested', layerType: 'scene', sceneId: 'scene', positionMs: 0, trimStartMs: 0, trimmedDurationMs: 1000,
		compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	COMMAND_DEFS.addScene.create({ id: 'parent', name: 'Parent', layers: [nested] }).execute(state);
	const before = structuredClone(state.timelineScenes.value);
	assert.throws(() => COMMAND_DEFS.removeScene.create({ sceneId: 'scene' }).execute(state), /Scene is used by/);
	assert.throws(() => COMMAND_DEFS.addSceneLayer.create({ sceneId: 'scene', layer: { ...nested, sceneId: 'parent' } }).execute(state), /Circular scene reference/);
	assert.deepEqual(state.timelineScenes.value, before);
	const remove = COMMAND_DEFS.removeScene.create({ sceneId: 'parent' });
	remove.execute(state);
	remove.undo(state);
	assert.deepEqual(state.timelineScenes.value, before);
});
