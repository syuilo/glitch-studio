import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testGraph } from './helpers/effect-graph.mjs';
import { nodeParameterTarget, timelineParameterTarget, customParameterTarget } from './helpers/command-inputs.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createTextTimelineLayer } from './src/utility/text-timeline-layer.ts';
		export { createInlineCustomNodeGraphEffectLayer } from './src/utility/inline-custom-node-graph-effect-layer.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
		export { createInlineAutomationGraph } from './src/utility/automation-graph.ts';
		export { default as definition } from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts';
	` },
	plugins: [{ name: 'parameter-auto-merge-platform', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$|preferences\.ts$/ }, ({ path }) => ({ path, namespace: 'platform' }));
		build.onLoad({ filter: /.*/, namespace: 'platform' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path.endsWith('preferences.ts') ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: "import definition from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts'; export const nativeEffectDefinitions = { testStructArray: definition };",
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { COMMAND_DEFS, UndoRedo, definition, createTextTimelineLayer, createInlineCustomNodeGraphEffectLayer, createInlineKeyframesTimeline, createInlineAutomationGraph } = loaded.exports;
const defaultBuzzId = createDefaultParameterBinding(definition.paramDefs.buzzs).value[0].id;
const literal = value => ({ inputSource: 'literal', value });
const scalar = { dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: 0 };

function fixture(t) {
	let now = 0;
	t.mock.method(performance, 'now', () => now);
	t.mock.method(console, 'log', () => {});
	const createCustomNodeGraphEffect = id => ({ id, definition: testGraph({ nodes: ['first-node', 'second-node'].map(id => ({ id, type: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' },
			params: Object.fromEntries(Object.entries(definition.paramDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)])),
		})), paramDefs: { "gain": { nameForReference: 'gain', canNode: false, ...scalar } }, customParameterDefs: { "gain": { nameForReference: 'gain', canNode: false, ...scalar } }, customParameterValues: {} }) });
	const customNodeGraphEffects = [createCustomNodeGraphEffect('first-custom-node-graph-effect'), createCustomNodeGraphEffect('second-custom-node-graph-effect')];
	const textLayer = { ...createTextTimelineLayer(0), id: 'text-layer' };
	const timelineScenes = ['first-scene', 'second-scene'].map(id => ({ id, name: id, layers: [
		structuredClone(textLayer), { ...createInlineCustomNodeGraphEffectLayer(0), id: 'inline-layer', effectSource: { type: 'inlineCustomNodeGraphEffect', customNodeGraphEffect: createCustomNodeGraphEffect('inline-definition').definition } },
	] }));
	const state = { customNodeGraphEffects: { value: customNodeGraphEffects }, timelineScenes: { value: timelineScenes } };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const target = { customNodeGraphEffectId: customNodeGraphEffects[0].id, nodeId: 'first-node', paramPath: ['buzzs', defaultBuzzId, 'x'] };
	const value = () => customNodeGraphEffects[0].definition.nodes[0].params.buzzs.value[0].binding.value.x;
	const notifications = [];
	manager.onChange(changes => notifications.push({ changes: structuredClone(changes), value: structuredClone(value()) }));
	return { state, manager, target, value, customNodeGraphEffects, timelineScenes, notifications,
		at(time) { now = time; },
		set(value, mergeKey = null) { manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...target }), source: { inputSource: 'literal', value: value } }, mergeKey); },
	};
}

// 【直前の更新から2000ms以内を含め、連続入力全体を一つのUndoへまとめる】
// 最初の履歴の作成時刻で測ると長く続く入力が途中で分割される。値と通知は毎回反映し、
// Undoは開始値、Redoは最終値へ戻すことで、履歴だけをまとめることも確認する。
test('merges through the inclusive 2000ms boundary measured from the previous update', t => {
	const f = fixture(t);
	f.set(1);
	const firstDate = f.manager.undoStack.value[0].date;
	f.at(2000); f.set(2);
	f.at(4000); f.set(3);
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.equal(f.manager.undoStack.value[0].date, firstDate);
	assert.deepEqual(f.notifications.map(notification => notification.value.value), [1, 2, 3]);
	f.manager.undo(); assert.deepEqual(f.value(), literal(0));
	f.manager.redo(); assert.deepEqual(f.value(), literal(3));
	assert.deepEqual(f.notifications.map(notification => notification.value.value), [1, 2, 3, 0, 3]);
	for (const notification of f.notifications) assert.equal(notification.changes[0].type, 'node');
});

// 【前回の更新から2000msを超えた操作は別の履歴にする】
// 閾値を含む比較と超過する比較を分け、一旦止めた調整をUndoで個別に戻せるようにする。
test('starts another history entry after more than 2000ms of inactivity', t => {
	const f = fixture(t);
	f.set(1);
	f.at(2001); f.set(2);
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo(); assert.deepEqual(f.value(), literal(1));
	f.manager.undo(); assert.deepEqual(f.value(), literal(0));
	f.manager.redo(); f.manager.redo(); assert.deepEqual(f.value(), literal(2));
});

// 【種類・Custom Node Graph Effectの所在・ノード・末端パスが違う編集を独立させる】
// 同じローカルIDが登録先やSceneを跨いで現れたり、配列内の隣の項目へ移っても、
// 最初と最後だけを履歴へ残すことで途中の編集が欠落してはならない。
test('separates command types and complete node parameter addresses', t => {
	const f = fixture(t);
	const before = structuredClone(f.state);
	const targets = [f.target, { ...f.target, paramPath: ['buzzs', defaultBuzzId, 'y'] },
		{ ...f.target, nodeId: 'second-node' }, { ...f.target, customNodeGraphEffectId: 'second-custom-node-graph-effect' },
		{ sceneId: 'first-scene', layerId: 'inline-layer', nodeId: 'first-node', paramPath: f.target.paramPath },
		{ sceneId: 'second-scene', layerId: 'inline-layer', nodeId: 'first-node', paramPath: f.target.paramPath }];
	for (const target of targets) f.manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...target }), source: { inputSource: 'literal', value: 1 } });
	f.manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...targets.at(-1) }), source: { inputSource: 'expression', expression: 'TIME' } });
	f.manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...targets.at(-1) }), source: { inputSource: 'expression', expression: 'TIME * 2' } });
	assert.equal(f.manager.undoStack.value.length, targets.length + 1);
	while (f.manager.canUndo.value) f.manager.undo();
	assert.deepEqual(f.state, before);
});

// 【タイムラインのScene・レイヤー・パラメータ群・項目・入力方式を区別する】
// 同じpositionを形状と合成設定が持つ場合や、同じIDが別Sceneにある場合も独立させる。
// ルートBindingのスナップショットを保存するコマンドでも、全編集を順に取り消せる必要がある。
test('merges timeline values and expressions only at the same parameter address', t => {
	const f = fixture(t);
	const before = structuredClone(f.state);
	const target = { sceneId: 'first-scene', layerId: 'text-layer', target: 'text', paramPath: ['position'] };
	for (const value of [[0.1, 0.2], [0.3, 0.4]]) f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target }), source: { inputSource: 'literal', value: value } });
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, target: 'compositing' }), source: { inputSource: 'literal', value: [0.2, 0.2] } });
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, sceneId: 'second-scene' }), source: { inputSource: 'literal', value: [0.2, 0.2] } });
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target }), source: { inputSource: 'expression', expression: '[TIME, 0]' } });
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target }), source: { inputSource: 'expression', expression: '[TIME * 2, 0]' } });
	assert.equal(f.manager.undoStack.value.length, 4);
	while (f.manager.canUndo.value) f.manager.undo();
	assert.deepEqual(f.state, before);
	while (f.manager.canRedo.value) f.manager.redo();
	assert.deepEqual(f.timelineScenes[0].layers[0].textParamValues.position, { inputSource: 'expression', expression: '[TIME * 2, 0]' });
});

// 【省略されたmodule対象を明示指定と同一視し、未設定の引数をUndoで復元する】
// 省略時と明示時で別のキーを作ると、呼び出し側の表記だけで履歴が分割される。
test('normalizes the default timeline parameter target and restores omitted bindings', t => {
	const f = fixture(t);
	const target = { sceneId: 'first-scene', layerId: 'inline-layer', paramPath: ['gain'] };
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target }), source: { inputSource: 'literal', value: 1 } });
	f.manager.commit('setTimelineLayerParameterSource', { ...timelineParameterTarget({ ...target, target: 'effect' }), source: { inputSource: 'literal', value: 2 } });
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo(); assert.deepEqual(Object.hasOwn(f.timelineScenes[0].layers[1].effectParamValues, 'gain'), false);
	f.manager.redo(); assert.deepEqual(f.timelineScenes[0].layers[1].effectParamValues.gain, literal(2));
});

// 【カスタム値は同じ定義の値入力だけをまとめ、既定値への暗黙の追従をUndoで戻す】
// 値を編集する前に保存値が無かった場合、Undoで既定値を明示保存してはならない。
// 登録先や編集方式が変わった操作も独立したUndo単位にする。
test('merges custom parameter values without changing definitions or losing omitted values', t => {
	const f = fixture(t);
	const target = { customNodeGraphEffectId: 'first-custom-node-graph-effect', parameterId: 'gain' };
	for (const value of [1, 2]) f.manager.commit('setCustomNodeGraphEffectCustomParameterSource', { target: customParameterTarget({ ...target }), source: { inputSource: 'literal', value: value } });
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo(); assert.deepEqual(f.customNodeGraphEffects[0].definition.customParameterValues, {});
	f.manager.redo(); assert.deepEqual(f.customNodeGraphEffects[0].definition.customParameterValues.gain, literal(2));
	for (const value of ['TIME', 'TIME * 2']) f.manager.commit('setCustomNodeGraphEffectCustomParameterSource', { target: customParameterTarget({ ...target }), source: { inputSource: 'expression', expression: value } });
	f.manager.commit('setCustomNodeGraphEffectCustomParameterSource', { target: customParameterTarget({ ...target, customNodeGraphEffectId: 'second-custom-node-graph-effect' }), source: { inputSource: 'literal', value: 3 } });
	assert.equal(f.manager.undoStack.value.length, 3);
	assert.deepEqual(f.customNodeGraphEffects[0].definition.customParameterDefs.gain.defaultValue, 0);
});

// 【キー・グラフ・リセット・定義変更は短時間に繰り返しても自動でまとめない】
// 同じ値更新の入口が構造編集にも使われるため、自動マージは値・式に限定する。
// 同一の操作を繰り返して値が変化しない場合は、履歴自体を追加しない。
test('keeps keyframe graph reset and definition commands out of automatic merging', t => {
	const f = fixture(t);
	const keyframes = createInlineKeyframesTimeline(scalar);
	const graph = createInlineAutomationGraph();
	const operations = [
		() => f.manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: keyframes }),
		() => f.manager.commit('setCustomNodeGraphEffectNodeParameterSource', { ...nodeParameterTarget({ ...f.target }), source: graph }),
		() => f.manager.commit('resetCustomNodeGraphEffectNodeParameter', { ...nodeParameterTarget(f.target) }),
		() => f.manager.commit('replaceCustomNodeGraphEffectPublicParameterDefinition', { target: { customNodeGraphEffect: { customNodeGraphEffectId: 'first-custom-node-graph-effect' }, parameterId: 'gain' }, definition: { ...f.customNodeGraphEffects[0].definition.paramDefs.gain, defaultValue: 1 } }),
	];
	for (const operation of operations) { operation(); operation(); }
	assert.equal(f.manager.undoStack.value.length, operations.length);
});

// 【明示キーによる操作は時間制限を受けず、自動マージとは接続しない】
// 長いドラッグを分割したり、その前後の通常入力まで同じ履歴へ取り込まない。
test('preserves explicit merging and isolates it from automatic merging', t => {
	const f = fixture(t);
	f.set(1);
	f.set(2, 'first-drag');
	f.at(5000); f.set(3, 'first-drag');
	f.set(4, 'second-drag');
	f.set(5); f.set(6);
	assert.equal(f.manager.undoStack.value.length, 4);
	for (const expected of [4, 3, 1, 0]) { f.manager.undo(); assert.deepEqual(f.value(), literal(expected)); }
	for (const expected of [1, 3, 4, 6]) { f.manager.redo(); assert.deepEqual(f.value(), literal(expected)); }
});

// 【確定・取消し・無更新の編集セッションを通常入力の境界にする】
// キャンセルしたからといって直前の通常入力との連続性を復活させず、プレビュー編集の
// 取消しで既存Redoを失わないという契約も自動マージ導入後に維持する。
test('keeps explicit edit sessions independent and preserves redo on cancellation', t => {
	const f = fixture(t);
	f.set(1);
	const cancelled = f.manager.beginEdit('setCustomNodeGraphEffectNodeParameterSource');
	cancelled.update({ ...nodeParameterTarget(f.target), source: { inputSource: 'literal', value: 2 } }); cancelled.cancel();
	f.set(3);
	const empty = f.manager.beginEdit('setCustomNodeGraphEffectNodeParameterSource'); empty.finish();
	f.set(4);
	const finished = f.manager.beginEdit('setCustomNodeGraphEffectNodeParameterSource');
	finished.update({ ...nodeParameterTarget(f.target), source: { inputSource: 'literal', value: 5 } }); finished.finish();
	f.set(6);
	assert.equal(f.manager.undoStack.value.length, 5);
	f.manager.undo();
	const session = f.manager.beginEdit('setCustomNodeGraphEffectNodeParameterSource');
	session.update({ ...nodeParameterTarget(f.target), source: { inputSource: 'literal', value: 7 } }); session.cancel();
	assert.equal(f.manager.redoStack.value.length, 1);
	f.manager.redo(); assert.deepEqual(f.value(), literal(6));
});

// 【Undo/Redo後の入力は時間内でも以前の履歴を変更しない】
// Undoで露出した履歴やRedoで戻した履歴へ追加編集を吸収すると、戻す単位や分岐が壊れる。
test('starts fresh automatic groups after undo and redo', t => {
	const f = fixture(t);
	f.set(1); f.at(2001); f.set(2);
	f.manager.undo(); f.set(3);
	assert.equal(f.manager.undoStack.value.length, 2);
	assert.equal(f.manager.redoStack.value.length, 0);
	f.manager.undo(); assert.deepEqual(f.value(), literal(1));
	f.manager.redo(); f.set(4);
	assert.equal(f.manager.undoStack.value.length, 3);
	f.manager.undo(); assert.deepEqual(f.value(), literal(3));
});
