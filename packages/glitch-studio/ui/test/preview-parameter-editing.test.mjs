import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { ref } from 'vue';

const directory = fileURLToPath(new URL('../', import.meta.url));
const literal = value => ({ inputSource: 'literal', value });
const definition = { dataType: { kind: 'vector' }, ui: { label: 'Position', control: { controlType: 'xy' } }, defaultValue: literal([0, 0]) };
const effect = { id: 'test', paramDefs: { first: definition, second: definition } };
const bundled = await build({ absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'],
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export * from './src/utility/preview-parameter-editing.ts';
		export * from './src/utility/preview-parameter-position.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
	` },
	plugins: [{ name: 'preview-parameter-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'stub' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'effects'
			? `export const effectDefinitions = { test: ${JSON.stringify(effect)} };` : 'export const preferences = { s: { forceTypeSafety: false } };' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { PreviewParameterEditingController, getPreviewParameterPosition, beginPreviewParameterBindingEdit, preparePreviewParameterDrag,
	previewParameterToScreen, previewScreenToParameter, snapPreviewParameterPosition, UndoRedo, COMMAND_DEFS, createInlineKeyframesTimeline } = module.exports;
const close = (actual, expected) => actual.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < 1e-12, `${actual} != ${expected}`));

function fixture() {
	const visualModule = { id: 'visualModule', nodes: [{ id: 'node', type: 'effect', effectId: 'test', params: { first: literal([0, 0]), second: literal([0.2, 0.1]) } }] };
	const state = { visualModules: ref([visualModule]), timelineScenes: ref([]), resolution: ref({ width: 1920, height: 1080 }) };
	const manager = new UndoRedo(state, COMMAND_DEFS);
	const node = state.visualModules.value[0].nodes[0];
	const scope = { kind: 'visualModule', target: { visualModuleId: visualModule.id } };
	const begin = () => {
		const binding = node.params.first;
		return preparePreviewParameterDrag(definition, binding, 500, 1000,
			beginPreviewParameterBindingEdit(manager, scope, 'node', null, ['first'], binding.inputSource));
	};
	return { state, manager, node, scope, begin };
}

// 【長辺基準の座標を、パン・倍率・縦横比のある表示領域へ往復変換する】
// 横幅と高さで別々に正規化すると非正方形で座標が歪み、プレビュー縮小時にも値が変わる。
test('maps isotropic coordinates through rectangular, translated and scaled previews', () => {
	for (const rect of [{ left: 42, top: 91, width: 800, height: 400 }, { left: -120, top: 8, width: 200, height: 400 }]) {
		for (const point of [[0, 0], [0.25, -0.125], [-0.5, 0.5]]) close(previewScreenToParameter(previewParameterToScreen(point, rect), rect), point);
		close(previewParameterToScreen([0, 0], rect), [rect.left + rect.width / 2, rect.top + rect.height / 2]);
	}
});

// 【グリッド非表示でも四辺・中央点・中央の縦横線へ正確に吸着する】
// 一軸だけが近いときも吸着し、他方の自由な座標を壊さないことを確認する。
test('snaps edges and center axes independently while the grid is hidden', () => {
	const rect = { left: 100, top: 50, width: 800, height: 400 };
	for (const expected of [[0.5, 0.25], [-0.5, -0.25], [0, 0], [0, 0.13], [0.12, 0]]) {
		const input = expected.map((component, axis) => component + (axis === 0 ? -0.003 : 0.002));
		const result = snapPreviewParameterPosition(input, rect, false);
		for (const axis of [0, 1]) {
			if (expected[axis] === 0 || Math.abs(expected[axis]) === (axis === 0 ? 0.5 : 0.25)) assert.equal(result[axis], expected[axis]);
			else assert.equal(result[axis], input[axis]);
		}
	}
});

// 【グリッドの全分割線は表示中だけ吸着し、吸着距離はCSS pxで一定にする】
// ズーム時に吸着範囲まで拡大したり、非表示の三分割線へ吸着したりするのを防ぐ。
test('snaps every visible grid line with a screen pixel threshold', () => {
	for (const width of [400, 1600]) {
		const rect = { left: 0, top: 0, width, height: width / 2 };
		for (const fraction of [1 / 4, 1 / 3, 2 / 3, 3 / 4]) {
			const candidate = fraction - 0.5;
			const input = [candidate + 4 / width, 0.07];
			assert.equal(snapPreviewParameterPosition(input, rect, true)[0], candidate);
			assert.equal(snapPreviewParameterPosition(input, rect, false)[0], input[0]);
			assert.equal(snapPreviewParameterPosition([candidate + 8 / width, 0.07], rect, true)[0], candidate + 8 / width);
		}
	}
});

// 【複数の有効状態を保持し、同じパラメータの重複パネルではハンドルを一つにする】
// パネルを一つ閉じても他方の操作を維持し、最後の表示元を閉じたときだけ解除する。
test('keeps multiple parameters enabled and shares duplicate registrations', () => {
	const controller = new PreviewParameterEditingController();
	const available = ref(true);
	const first = { key: 'first', available: () => available.value, position: () => [0, 0], label: () => 'First', begin: () => null };
	const unregisterFirst = controller.register(first);
	const unregisterDuplicate = controller.register(first);
	const unregisterSecond = controller.register({ ...first, key: 'second' });
	controller.toggle('first'); controller.toggle('second');
	assert.deepEqual(controller.handles.value.map(handle => handle.key), ['first', 'second']);
	unregisterFirst();
	assert.equal(controller.handles.value.length, 2);
	available.value = false;
	assert.equal(controller.handles.value.length, 0);
	available.value = true;
	assert.equal(controller.handles.value.length, 2);
	unregisterDuplicate();
	assert.equal(controller.isEnabled('first'), false);
	assert.equal(controller.isEnabled('second'), true);
	unregisterSecond();
	assert.equal(controller.handles.value.length, 0);
});

// 【連続した位置変更を一つのUndoにし、別パラメータと加工式を維持する】
// 固定値の基準座標だけを変更し、Undo/Redoでは一回のドラッグ全体を復元する。
test('edits only the selected base position as a single undoable command', () => {
	const f = fixture();
	f.node.params.first.expressionModifier = { enabled: true, code: 'VALUE * 2' };
	const drag = f.begin();
	drag.update([0.1, 0.2]); drag.update([0.3, -0.1]); drag.finish();
	assert.equal(f.manager.undoStack.value.length, 1);
	assert.deepEqual(f.node.params.first.value, [0.3, -0.1]);
	assert.deepEqual(f.node.params.second.value, [0.2, 0.1]);
	assert.equal(f.node.params.first.expressionModifier.code, 'VALUE * 2');
	f.manager.undo(); assert.deepEqual(f.node.params.first.value, [0, 0]);
	f.manager.redo(); assert.deepEqual(f.node.params.first.value, [0.3, -0.1]);
});

// 【操作中断と開始位置への復帰は既存Redoを残し、クリックだけでは履歴を作らない】
// 一時的な更新を確定履歴と混同するとEscだけでRedoを失ってしまう。
test('restores cancelled and unchanged drags without clearing redo', () => {
	const f = fixture();
	let drag = f.begin(); drag.update([0.1, 0.2]); drag.finish(); f.manager.undo();
	for (const mode of ['click', 'cancel', 'return']) {
		drag = f.begin();
		if (mode !== 'click') drag.update([0.3, 0.4]);
		if (mode === 'return') drag.update([0, 0]);
		if (mode === 'cancel') drag.cancel(); else drag.finish();
		assert.deepEqual(f.node.params.first.value, [0, 0]);
		assert.equal(f.manager.undoStack.value.length, 0);
		assert.equal(f.manager.redoStack.value.length, 1);
	}
});

// 【キーは現在時刻へ一つだけ追加し、既存キー・補間とRedo時のIDを維持する】
// pointermoveごとにキーを追加したり、単なるクリックでキーを作成したりしてはいけない。
test('inserts a single stable keyframe at the edit time and preserves interpolation', () => {
	const f = fixture();
	f.node.params.first = createInlineKeyframesTimeline(definition, literal([0, 0]));
	f.node.params.first.keyframesTimeline.keyframes.push({ id: 'end', x: 1000, value: [0.4, 0.2], interpolation: { type: 'hold' } });
	let drag = f.begin();
	assert.deepEqual(drag.initialPosition, [0.2, 0.1]); drag.finish();
	assert.equal(f.node.params.first.keyframesTimeline.keyframes.length, 2);
	drag = f.begin(); drag.update([0.3, 0.1]); drag.update([0.35, 0.15]); drag.finish();
	const keys = structuredClone(f.node.params.first.keyframesTimeline.keyframes.map(point => ({ ...point, value: [...point.value], interpolation: { ...point.interpolation } })));
	assert.equal(keys.length, 3);
	assert.equal(keys[1].x, 500); assert.deepEqual(keys[1].value, [0.35, 0.15]);
	assert.equal(keys[2].interpolation.type, 'hold');
	f.manager.undo(); assert.equal(f.node.params.first.keyframesTimeline.keyframes.length, 2);
	f.manager.redo(); assert.equal(f.node.params.first.keyframesTimeline.keyframes[1].id, keys[1].id);
});

// 【Timelineの保存先へ反映し、未指定の位置はUndoで未指定へ戻す】
// 表示用既定値を参照しただけで保存値を増やさず、Visual Moduleの保存先とも混同しない。
test('uses timeline layer commands and restores an omitted binding on undo', () => {
	const f = fixture();
	const layer = { id: 'layer', layerType: 'shape', compositingParamValues: {} };
	f.state.timelineScenes.value = [{ id: 'scene', layers: [layer] }];
	const session = beginPreviewParameterBindingEdit(f.manager, { kind: 'timelineLayer', sceneId: 'scene', layerId: 'layer' }, null, 'compositing', ['position'], 'literal');
	const drag = preparePreviewParameterDrag(definition, literal([0, 0]), 0, 1000, session);
	drag.update([0.25, 0.1]); drag.finish();
	assert.deepEqual(f.state.timelineScenes.value[0].layers[0].compositingParamValues.position.value, [0.25, 0.1]);
	f.manager.undo();
	assert.equal(Object.hasOwn(f.state.timelineScenes.value[0].layers[0].compositingParamValues, 'position'), false);
});

// 【外部コマンドで確定した古いドラッグは、新しい編集を取り消さない】
// 対象の削除・Undoなどと競合した際にも、古いセッションの取消しを安全にする。
test('does not roll back another command when an old drag is cancelled', () => {
	const f = fixture();
	const drag = f.begin(); drag.update([0.1, 0.1]);
	f.manager.commit('updateParamAsLiteral', { ...f.scope.target, nodeId: 'node', paramPath: ['first'], value: [0.4, 0.3] });
	assert.equal(drag.active, false); drag.cancel();
	assert.deepEqual(f.node.params.first.value, [0.4, 0.3]);
});

// 【式や参照入力を評価・上書きせず、XY以外のvectorも対象にしない】
// ボタン表示と編集可否を分け、式やノード接続を固定値へ暗黙に変更しない。
test('rejects driven inputs and vector controls without evaluating expressions', () => {
	for (const binding of [{ inputSource: 'expression', expression: 'invalid' }, { inputSource: 'node', nodeId: 'other', outputPort: 'output' },
		{ inputSource: 'visualModulePublicParameterReference', parameterId: 'parameter' }]) assert.equal(getPreviewParameterPosition(definition, binding, 0, 1000), null);
	assert.equal(getPreviewParameterPosition({ ...definition, ui: { ...definition.ui, control: { controlType: 'vector' } } }, literal([0, 0]), 0, 1000), null);
});
