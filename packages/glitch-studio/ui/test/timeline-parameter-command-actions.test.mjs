import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { commitTimelineParameterEdit } from './src/utility/timeline-parameter-command-actions.ts';
		export { getTimelineParameterEditBinding } from './src/commands/timeline-parameter-api.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { createInlineCustomNodeGraphEffectLayer } from './src/utility/inline-custom-node-graph-effect-layer.ts';
		export { createTextTimelineLayer } from './src/utility/text-timeline-layer.ts';
		export { default as definition } from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts';
	` },
	plugins: [{ name: 'timeline-parameter-effects', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ loader: 'ts', resolveDir: directory,
			contents: path === 'preferences' ? 'export const preferences = { s: { forceTypeSafety: false } };' : "import definition from '@gs/subsystems_effect_native-effects/fx/testStructArray/_def_.ts'; export const nativeEffectDefinitions = { testStructArray: definition };",
		}));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { COMMAND_DEFS, UndoRedo, commitTimelineParameterEdit, getTimelineParameterEditBinding,
	createEffectTimelineLayer, createInlineCustomNodeGraphEffectLayer, createTextTimelineLayer, definition } = loaded.exports;

function fixture(t, layer) {
	// 全操作を同じ時刻に固定し、自動マージの時間条件が必ず満たされる状況で確認する。
	t.mock.method(performance, 'now', () => 0);
	const state = { timelineScenes: { value: [{ id: 'scene', name: 'Scene', layers: [layer] }] }, customNodeGraphEffects: { value: [] }, assets: { value: [] } };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const notifications = [];
	manager.onChange(changes => notifications.push(changes[0].changes[0].kind));
	return { state, manager, notifications,
		edit(target, paramPath, edit) { commitTimelineParameterEdit(manager, { sceneId: 'scene', layerId: layer.id, target, paramPath, edit }); },
	};
}

// 【値の連続入力だけをまとめ、加工式・リセットは独立してUndoする】
// 編集後のBindingがどれもliteralでも、UIで行った別操作を同じ履歴へ潰さない。
// 加工式のUndoが、その前に入力した本文まで取り消す回帰を防ぐ。
test('merges consecutive values but separates modifier and reset UI actions', t => {
	const layer = createTextTimelineLayer(0);
	const f = fixture(t, layer);
	f.edit('text', ['text'], { kind: 'literal', value: 'First' });
	f.edit('text', ['text'], { kind: 'literal', value: 'Edited' });
	assert.equal(f.manager.undoStack.value.length, 1);
	const modifier = { enabled: true, code: 'VALUE' };
	f.edit('text', ['text'], { kind: 'expressionModifier', value: modifier });
	assert.equal(f.manager.undoStack.value.length, 2);
	f.edit('text', ['text'], { kind: 'reset' });
	assert.equal(f.manager.undoStack.value.length, 3);
	assert.equal(f.notifications.at(-1), 'reset');
	f.manager.undo();
	assert.deepEqual(layer.textParamValues.text, { inputSource: 'literal', value: 'Edited', expressionModifier: modifier });
	f.manager.undo();
	assert.deepEqual(layer.textParamValues.text, { inputSource: 'literal', value: 'Edited' });
	f.manager.undo();
	assert.equal(layer.textParamValues.text.value, 'Hello, world!');
	f.manager.redo(); f.manager.redo(); f.manager.redo();
	assert.equal(layer.textParamValues.text.value, 'Hello, world!');
	assert.equal(f.notifications.at(-1), 'reset');
});

// 【配列内structの末端パスを保持し、隣のフィールドを別の履歴にする】
// ルートBindingへ縮めてからマージするとxとyが同じ対象になり、片方だけUndoできない。
// 同じ末端の反復入力は一履歴のまま、別の末端へ移ったところで区切る。
test('preserves nested parameter paths and merges only the edited leaf', t => {
	const layer = createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 0);
	const f = fixture(t, layer);
	const path = ['buzzs', 'first', 'x'];
	const converted = getTimelineParameterEditBinding(f.state, { sceneId: 'scene', layerId: layer.id, target: 'effect', paramPath: path, edit: { kind: 'literal', value: 1 } });
	assert.deepEqual(converted.parameterPath, path);
	assert.deepEqual(converted.binding, { inputSource: 'literal', value: 1 });
	f.edit('effect', path, { kind: 'literal', value: 0.1 });
	f.edit('effect', path, { kind: 'literal', value: 0.2 });
	f.edit('effect', ['buzzs', 'first', 'y'], { kind: 'literal', value: 0.3 });
	assert.equal(f.manager.undoStack.value.length, 2);
	const values = () => layer.effectParamValues.buzzs.value[0].binding.value;
	f.manager.undo();
	assert.equal(values().x.value, 0.2);
	assert.equal(values().y.value, 0);
	f.manager.undo();
	assert.equal(values().x.value, 0);
	f.manager.redo(); f.manager.redo();
	assert.equal(values().x.value, 0.2);
	assert.equal(values().y.value, 0.3);
});

// 【入力方式の切替を続く式入力から分離し、配列操作とネストしたキーも自動統合しない】
// 親Bindingがliteralであっても、末端の方式と操作の意味で履歴を決める。
// 配列の構造変更通知は、値編集と異なりレンダラーの再構築が必要になる。
test('separates source switches arrays and nested keyframes from value typing', t => {
	const layer = createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 0);
	const f = fixture(t, layer);
	const path = ['buzzs', 'first', 'x'];
	f.edit('effect', path, { kind: 'inputSource', inputSource: 'expression' });
	f.edit('effect', path, { kind: 'expression', value: 'TIME' });
	f.edit('effect', path, { kind: 'expression', value: 'TIME * 2' });
	assert.equal(f.manager.undoStack.value.length, 2);
	f.manager.undo();
	assert.equal(layer.effectParamValues.buzzs.value[0].binding.value.x.expression, '0');
	f.manager.undo();
	assert.equal(layer.effectParamValues.buzzs.value[0].binding.value.x.inputSource, 'literal');
	f.edit('effect', ['bars'], { kind: 'addElement' });
	f.edit('effect', ['bars'], { kind: 'addElement' });
	assert.equal(f.manager.undoStack.value.length, 2);
	assert.deepEqual(f.notifications.slice(-2), ['arrayElements', 'arrayElements']);
	f.edit('effect', ['bars'], { kind: 'removeElement', elementId: layer.effectParamValues.bars.value[0].id });
	assert.equal(f.manager.undoStack.value.length, 3);
	assert.equal(f.notifications.at(-1), 'arrayElements');
	const keyframes = value => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [{ id: 'key', x: 0, value, interpolation: { type: 'linear' } }] } });
	f.edit('effect', path, { kind: 'keyframesTimelineInline', value: keyframes(0.1) });
	f.edit('effect', path, { kind: 'keyframesTimelineInline', value: keyframes(0.2) });
	assert.equal(f.manager.undoStack.value.length, 5);
	f.manager.undo();
	assert.equal(layer.effectParamValues.buzzs.value[0].binding.value.x.keyframesTimeline.keyframes[0].value, 0.1);
});

// 【完全Binding置換は自動統合せず、内容から配線・入力方式・配列の変更を通知する】
// 貼り付けやスクリプトはUIイベントを持たないため、Command自身が静的状態の破棄に
// 必要な差分を判定する。Undo/Redoでも同じ変更種別を通知する。
test('classifies complete replacements and preserves notifications through undo and redo', t => {
	const layer = createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 0);
	const f = fixture(t, layer);
	const reference = { sceneId: 'scene', layerId: layer.id, parameterGroup: 'effect', parameterPath: ['foo'] };
	const replace = binding => f.manager.commit('replaceTimelineLayerParameterBinding', { ...reference, binding });
	const connected = { inputSource: 'literal', value: { node: { inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'source', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' } } };
	replace(connected);
	assert.equal(f.notifications.at(-1), 'inputSource');
	replace({ ...connected, value: { node: { ...connected.value.node, outputStage: 'rendered' } } });
	assert.equal(f.notifications.at(-1), 'connection');
	f.manager.undo(); f.manager.redo();
	assert.deepEqual(f.notifications.slice(-2), ['connection', 'connection']);
	const scalarReference = { ...reference, parameterPath: ['buzzs', 'first', 'x'] };
	for (const value of [0.1, 0.2]) f.manager.commit('replaceTimelineLayerParameterBinding', { ...scalarReference, binding: { inputSource: 'literal', value } });
	assert.equal(f.manager.undoStack.value.length, 4);
	f.manager.undo();
	assert.equal(layer.effectParamValues.buzzs.value[0].binding.value.x.value, 0.1);
	const array = structuredClone(layer.effectParamValues.buzzs);
	array.value.push({ ...structuredClone(array.value[0]), id: 'second' });
	f.manager.commit('replaceTimelineLayerParameterBinding', { ...reference, parameterPath: ['buzzs'], binding: array });
	assert.equal(f.notifications.at(-1), 'arrayElements');
});

// 【Custom Node Graph Effect引数の接続・リセットを値通知として扱わない】
// レンダラーはこの対象のvalue通知ではインスタンスを維持するため、画像の接続先変更や
// リセットをvalueに落とすと、古い配線・静的状態が再利用される。
test('reports structural changes for Custom Node Graph Effect argument UI actions', t => {
	const layer = createInlineCustomNodeGraphEffectLayer(0);
	const f = fixture(t, layer);
	const path = [layer.effectSource.customNodeGraphEffect.primaryInputParameter];
	f.edit('effect', path, { kind: 'inputSource', inputSource: 'anotherLayerOutput' });
	f.edit('effect', path, { kind: 'anotherLayerOutput', value: { inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'rendered' } });
	f.edit('effect', path, { kind: 'reset' });
	assert.deepEqual(f.notifications, ['inputSource', 'connection', 'reset']);
	f.manager.undo(); f.manager.undo(); f.manager.undo();
	assert.deepEqual(f.notifications.slice(-3), ['reset', 'connection', 'inputSource']);
	f.manager.redo(); f.manager.redo(); f.manager.redo();
	assert.deepEqual(f.notifications.slice(-3), ['inputSource', 'connection', 'reset']);
});
