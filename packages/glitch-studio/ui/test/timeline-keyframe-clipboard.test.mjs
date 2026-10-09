import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createTimelineClipboardHandlers } from './helpers/timeline-clipboard-actions.mjs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export { createTimelineClipboardActions } from './src/utility/timeline-clipboard-actions.ts';
		export { flattenTimelineLayers } from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export * from './src/utility/timeline-keyframe-clipboard.ts';
		export * from './src/utility/timeline-clip-clipboard.ts';
		export * from './src/utility/timeline-scene.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createShapeTimelineLayer } from './src/utility/shape-timeline-layer.ts';
		export { resolveParameter } from '@gs/shared/parameter/parameter-path.ts';
		export { genId } from '@gs/shared/utility/id.ts';
		export { default as arrayDefinition } from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'keyframe-clipboard-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			contents: path === 'effects'
				? "import definition from '@gs/subsystems_effect_shared/fx/testStructArray/_def_.ts'; export const effectDefinitions = { [definition.id]: definition };"
				: 'export const preferences = { s: { forceTypeSafety: true } };', loader: 'ts', resolveDir: uiDirectory,
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection, getTimelineKeyframePasteUpdates, copyTimelineClips,
	COMMAND_DEFS, UndoRedo, createShapeTimelineLayer, createInlineKeyframesTimeline, resolveLayerParameter,
	getLayerParameterDefinitions, getLayerParameterValues, resolveParameter, arrayDefinition, genId } = module.exports;

const createHandler = context => createTimelineClipboardHandlers(module.exports, context).onTlKeydown;

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const layer = createShapeTimelineLayer('rectangle', 100);
	layer.id = 'shape';
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	function addLane(layerId, target, paramPath, points) {
		const layer = scene.layers.find(layer => layer.id === layerId);
		const defs = getLayerParameterDefinitions(state, layer, target);
		const values = getLayerParameterValues(layer, target);
		const { def } = resolveLayerParameter(state, layer, target, paramPath);
		const binding = createInlineKeyframesTimeline(def);
		binding.keyframesTimeline.keyframes = points;
		if (paramPath.length === 1) values[paramPath[0]] = binding;
		else resolveParameter(defs, values, paramPath).setValue(binding);
		return points.map(point => ({ layerId, target, paramPath, keyframeId: point.id }));
	}
	const selection = addLane('shape', 'shape', ['size'], [
		{ id: 'a', x: 100, value: [0.2, 0.3], interpolation: { type: 'ease:quad', direction: 'inOut' } },
		{ id: 'b', x: 300, value: [0.4, 0.5], interpolation: { type: 'hold' } },
	]);
	return { layer, scene, state, history, changes, selection, addLane,
		get clipboard() { return copyTimelineKeyframes(state, scene, selection); },
		read(point) { return resolveLayerParameter(state, scene.layers.find(layer => layer.id === point.layerId), point.target, point.paramPath).value; },
	};
}

// 【コピー時の値・補間を保持し、先頭をシーク位置に合わせて全キーの間隔を維持する】
// キーの選択順やコピー後の値編集に影響されず、繰り返し貼り付ける場合も新しいIDを使う。
test('snapshots values and interpolation and offsets all keys from the earliest copied time', t => {
	const f = fixture(t);
	const clipboard = copyTimelineKeyframes(f.state, f.scene, f.selection.toReversed());
	f.read(f.selection[0]).keyframesTimeline.keyframes[0].value[0] = 9;
	const first = prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000.4);
	const second = prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 2000);
	assert.deepEqual(first.map(entry => [entry.keyframe.x, entry.keyframe.value, entry.keyframe.interpolation]), [
		[1200, [0.4, 0.5], { type: 'hold' }], [1000, [0.2, 0.3], { type: 'ease:quad', direction: 'inOut' }],
	]);
	assert.equal(new Set([...first, ...second, ...clipboard.keyframes].map(entry => entry.keyframe.id)).size, 6);
	assert.deepEqual(clipboard.keyframes.map(entry => entry.keyframe.x), [300, 100]);
});

// 【複数レイヤー・複数パラメータへの貼り付けを一回のUndo/Redoで扱う】
// 同時刻でも所属レーンが違えば許可し、クリップ・他のキー・レイヤー設定を変更しない。
test('pastes across original lanes with one undo entry and parameter value notifications', t => {
	const f = fixture(t);
	f.selection.push(...f.addLane('shape', 'compositing', ['opacity'], [{ id: 'a', x: 200, value: 0.8, interpolation: { type: 'linear' } }]));
	f.scene.layers.push({ id: 'audio', layerType: 'audio', clips: [], audioParamValues: {}, automationGraphs: [] });
	f.selection.push(...f.addLane('audio', 'audio', ['volume'], [{ id: 'a', x: 100, value: 0.5, interpolation: { type: 'linear' } }]));
	const before = structuredClone(f.scene);
	const keyframes = prepareTimelineKeyframePaste(f.state, f.scene, f.clipboard, 1000);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes });
	const after = structuredClone(f.scene);
	assert.deepEqual(keyframes.map(entry => entry.keyframe.x), [1000, 1200, 1100, 1000]);
	assert.equal(f.history.undoStack.value.length, 1);
	f.history.undo();
	assert.deepEqual(f.scene, before);
	f.history.redo();
	assert.deepEqual(f.scene, after);
	assert.equal(f.changes.length, 3);
	for (const changes of f.changes) assert.deepEqual(changes, [
		{ type: 'layer', sceneId: 'scene', layerId: 'shape', changes: [{ type: 'parameter', target: 'shape', kind: 'value' }] },
		{ type: 'layer', sceneId: 'scene', layerId: 'shape', changes: [{ type: 'parameter', target: 'compositing', kind: 'value' }] },
		{ type: 'layer', sceneId: 'scene', layerId: 'audio', changes: [{ type: 'parameter', target: 'audio', kind: 'value' }] },
	]);
});

// 【同じレーンの同時刻キーが一つでもある場合は全体を拒否する】
// キー間に既存キーがあるだけなら許可し、上書きや押し出しを行わない。
// Commandへ直接渡しても状態・Undo/Redo履歴・同期通知が変わらないようにする。
test('rejects collisions and invalid times atomically while allowing existing keys between pasted points', t => {
	const f = fixture(t);
	const clipboard = f.clipboard;
	for (const time of [100, 300, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
		assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, time), null);
	}
	const keyframes = prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes });
	f.history.undo();
	f.changes.length = 0;
	f.read(f.selection[0]).keyframesTimeline.keyframes.push({ id: 'between', x: 1100, value: [1, 1], interpolation: { type: 'linear' } });
	assert.ok(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000));
	f.read(f.selection[0]).keyframesTimeline.keyframes.push({ id: 'blocking', x: 1200, value: [1, 1], interpolation: { type: 'linear' } });
	const before = structuredClone(f.scene);
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000), null);
	assert.throws(() => f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes }), /Invalid or overlapping/);
	assert.deepEqual(f.scene, before);
	assert.equal(f.history.undoStack.value.length, 0);
	assert.equal(f.history.redoStack.value.length, 1);
	assert.deepEqual(f.changes, []);
});

// 【同じ配列ルート内の複数レーンをIDパスで編集し、互いの追加を上書きしない】
// 配列の表示順が変わってもコピー元IDを使い、要素を削除した後は残った要素へ振り替えない。
test('merges nested array lanes into one root draft and preserves element IDs through undo', t => {
	const f = fixture(t);
	const values = Object.fromEntries(Object.entries(arrayDefinition.paramDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));
	values.buzzs.value.push({ ...structuredClone(values.buzzs.value[0]), id: 'second' });
	f.scene.layers.push({ id: 'effect', layerType: 'effect', effectId: arrayDefinition.id, effectParamValues: values, clips: [], compositingParamValues: {} });
	f.selection.length = 0;
	for (const id of ['first', 'second']) f.selection.push(...f.addLane('effect', 'effect', ['buzzs', id, 'x'], [
		{ id: 'same-key-id', x: 100, value: 0.5, interpolation: { type: 'linear' } },
	]));
	const clipboard = f.clipboard;
	values.buzzs.value.reverse();
	const before = structuredClone(f.scene);
	const keyframes = prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes });
	for (const point of f.selection) assert.deepEqual(f.read(point).keyframesTimeline.keyframes.map(key => key.x), [100, 1000]);
	f.history.undo();
	assert.deepEqual(f.scene, before);
	values.buzzs.value = values.buzzs.value.filter(element => element.id !== 'first');
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000), null);
});

// 【同じScene・レイヤー・キー入力のパラメータだけに貼り付ける】
// コピー元キーの削除はスナップショットへ影響しないが、レーン自体の削除や型変更は貼り付けを止める。
test('requires the original scene and compatible surviving lanes without requiring source keys', t => {
	const f = fixture(t);
	const clipboard = f.clipboard;
	assert.equal(prepareTimelineKeyframePaste(f.state, structuredClone(f.scene), clipboard, 1000), null);
	f.read(f.selection[0]).keyframesTimeline.keyframes = [];
	assert.ok(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000));
	f.layer.shape.paramValues.size = { inputSource: 'literal', value: [0.5, 0.5] };
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000), null);
	assert.equal(copyTimelineKeyframes(f.state, f.scene, f.selection), null);
	f.scene.layers = [];
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000), null);
});

// 【未設定のモジュール引数では既定Bindingを変更せず、Undoで未設定へ戻す】
// 既定値のキーを共有定義に直接追加すると、別の配置にもキーが増えてしまう。
// enumの候補が更新された場合も、追加する値を現在の選択肢で検証する。
test('materializes default module arguments independently and validates enum options at paste time', t => {
	const f = fixture(t);
	const dataType = { kind: 'enum', options: ['one', 'two'] };
	const def = { id: 'choice', dataType, ui: { label: 'Choice', control: { labels: {} } }, canNode: false,
		defaultValue: { inputSource: 'literal', value: 'one' } };
	def.defaultValue = createInlineKeyframesTimeline(def);
	def.defaultValue.keyframesTimeline.keyframes[0].id = 'default-key';
	const visualModule = { id: 'module', paramDefs: [def] };
	f.state.visualModules.value.push(visualModule);
	f.scene.layers.push({ id: 'module-layer', layerType: 'visualModule', visualModuleId: 'module', visualModuleParamValues: {}, clips: [], compositingParamValues: {} });
	f.selection.length = 0;
	f.selection.push({ layerId: 'module-layer', target: 'module', paramPath: ['choice'], keyframeId: 'default-key' });
	const clipboard = f.clipboard;
	const originalDefault = structuredClone(def.defaultValue);
	const keyframes = prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes });
	assert.deepEqual(def.defaultValue, originalDefault);
	assert.deepEqual(f.read(f.selection[0]).keyframesTimeline.keyframes.map(point => point.x), [0, 1000]);
	f.history.undo();
	assert.deepEqual(f.scene.layers.at(-1).visualModuleParamValues, {});
	def.dataType.options = ['two'];
	assert.equal(prepareTimelineKeyframePaste(f.state, f.scene, clipboard, 1000), null);
	const malformed = structuredClone(keyframes);
	malformed[0].keyframe.interpolation = { type: 'linear' };
	assert.equal(getTimelineKeyframePasteUpdates(f.state, f.scene, malformed), null);
});

// 【既定値から表示したキーをレイヤー側で削除し、Undoで未設定に戻す】
// 未設定ルートの既定Bindingはコピーなので直接変更しても保存されない。配列・構造体は
// 先にルートを用意し、同じルートの別レーンを一括削除しても互いの変更を残す必要がある。
test('removes default keys from independent root drafts and restores unset arguments on undo', t => {
	for (const nested of [false, true]) {
		const f = fixture(t);
		const scalar = { id: 'value', dataType: { kind: 'scalar' }, ui: { label: 'Value', control: {} }, defaultValue: { inputSource: 'literal', value: 0 } };
		const keys = createInlineKeyframesTimeline(scalar);
		keys.keyframesTimeline.keyframes = [
			{ id: 'remove', x: 100, value: 0.5, interpolation: { type: 'linear' } },
			{ id: 'keep', x: 200, value: 1, interpolation: { type: 'linear' } },
		];
		const def = nested ? { ...structuredClone(arrayDefinition.paramDefs.buzzs), id: 'value' } : scalar;
		if (nested) {
			def.defaultValue.value[0].binding.value.x = structuredClone(keys);
			def.defaultValue.value[0].binding.value.y = structuredClone(keys);
		} else def.defaultValue = keys;
		const visualModule = { id: 'module', paramDefs: [def] };
		f.state.visualModules.value.push(visualModule);
		for (const id of ['edited', 'untouched']) f.scene.layers.push({ id, layerType: 'visualModule', visualModuleId: 'module',
			visualModuleParamValues: {}, clips: [], compositingParamValues: {} });
		const paths = nested ? [['value', 'first', 'x'], ['value', 'first', 'y']] : [['value']];
		const selection = paths.map(paramPath => ({ layerId: 'edited', target: 'module', paramPath, keyframeId: 'remove' }));
		const before = structuredClone(f.scene);
		const originalDefault = structuredClone(def.defaultValue);
		f.history.commit('removeTimelineKeyframes', { sceneId: 'scene', keyframes: selection });
		const after = structuredClone(f.scene);
		for (const point of selection) assert.deepEqual(f.read(point).keyframesTimeline.keyframes.map(key => key.id), ['keep']);
		assert.deepEqual(def.defaultValue, originalDefault);
		assert.deepEqual(f.scene.layers.at(-1).visualModuleParamValues, {});
		assert.equal(f.history.undoStack.value.length, 1);
		for (let repeat = 0; repeat < 2; repeat++) {
			f.history.undo();
			assert.deepEqual(f.scene, before);
			f.history.redo();
			assert.deepEqual(f.scene, after);
		}
		f.history.undo();
		const changes = f.changes.length;
		assert.throws(() => f.history.commit('removeTimelineKeyframes', { sceneId: 'scene',
			keyframes: [...selection, { ...selection[0], keyframeId: 'missing' }] }), /Timeline keyframe not found/);
		assert.deepEqual(f.scene, before);
		assert.deepEqual(def.defaultValue, originalDefault);
		assert.equal(f.changes.length, changes);
		assert.equal(f.history.undoStack.value.length, 0);
		assert.equal(f.history.redoStack.value.length, 1);
	}
});

// 【Ctrl/Cmd+C・Vでキーを操作し、貼り付け後の選択とクリップボードの種類を更新する】
// 選択対象が変わってもコピー元レーンへ貼り付け、入力欄のコピーやキーリピートは奪わない。
test('copies and pastes keyframes through shortcuts and switches clipboard kinds correctly', async t => {
	for (const modifiers of [{ ctrlKey: true }, { ctrlKey: false, metaKey: true }]) {
		const f = fixture(t);
		const selection = { value: { kind: 'keyframes', keyframes: f.selection } };
		const timelineClipboard = { value: null };
		const context = { HTMLElement: class {}, selection, editedScene: f.scene, timelineClipboard,
			selectedLayer: { value: f.layer }, props: { sceneId: 'scene' }, stateManager: f.history,
			tlEl: { value: { focus() {} } }, time: { value: 1000.4 }, disposed: false,
			copyTimelineKeyframes, prepareTimelineKeyframePaste, getPastedTimelineKeySelection, copyTimelineClips };
		const keydown = createHandler(context);
		const keyboard = (key, overrides = {}) => ({ key, ctrlKey: true, metaKey: false, ...modifiers,
			repeat: false, defaultPrevented: false, target: null, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...overrides });
		await keydown(keyboard('c'));
		assert.equal(timelineClipboard.value.kind, 'keyframes');
		selection.value = { kind: 'layers', ids: [f.layer.id] };
		await keydown(keyboard('v', { repeat: true }));
		assert.equal(f.history.undoStack.value.length, 0);
		await keydown(keyboard('v'));
		assert.equal(selection.value.kind, 'keyframes');
		assert.deepEqual(selection.value.keyframes.map(point => f.read(point).keyframesTimeline.keyframes.find(key => key.id === point.keyframeId).x), [1000, 1200]);
		await keydown(keyboard('v'));
		assert.equal(f.history.undoStack.value.length, 1);
		const input = new context.HTMLElement();
		input.closest = () => true;
		const typing = keyboard('c', { target: input });
		await keydown(typing);
		assert.equal(typing.defaultPrevented, false);
		selection.value = { kind: 'clips', clips: [{ layerId: f.layer.id, clipId: f.layer.clips[0].id }] };
		await keydown(keyboard('c'));
		assert.equal(timelineClipboard.value.kind, 'clips');
		selection.value = { kind: 'layers', ids: [f.layer.id] };
		await keydown(keyboard('c'));
		assert.equal(timelineClipboard.value.kind, 'layer');
	}
});
