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
		export * from './src/utility/preview-viewport.ts';
		export { default as mandelbrot } from '@gs/subsystems_effect_shared/fx/mandelbrot/_def_.ts';
		export { default as magneticPendulum } from '@gs/subsystems_effect_shared/fx/magneticPendulum/_def_.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
	` },
	plugins: [{ name: 'preview-parameter-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'stub' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ resolveDir: directory, contents: path === 'effects'
			? `import mandelbrot from '@gs/subsystems_effect_shared/fx/mandelbrot/_def_.ts'; export const effectDefinitions = { test: { ...mandelbrot, ...${JSON.stringify(effect)}, paramDefs: { ...${JSON.stringify(effect.paramDefs)}, view: mandelbrot.paramDefs.view } } };`
			: 'export const preferences = { s: { forceTypeSafety: false } };' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { PreviewParameterEditingController, getPreviewParameterPosition, beginPreviewParameterBindingEdit, preparePreviewParameterDrag,
	previewParameterToScreen, previewScreenToParameter, snapPreviewParameterPosition, preparePreviewViewportDrag, beginPreviewViewportBindingEdit,
	panPreviewViewport, zoomPreviewViewport, getPreviewViewportValue, mandelbrot, magneticPendulum, UndoRedo, COMMAND_DEFS, createInlineKeyframesTimeline } = module.exports;
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

// 【一時的に操作不可の表示範囲も、別の位置ハンドルを選んだ時点で解除する】
// バイパス解除や再生停止によって、以前の全面操作が現在の位置編集へ重なるのを防ぐ。
test('clears an unavailable viewport when switching to a position handle', () => {
	const controller = new PreviewParameterEditingController();
	const available = ref(true);
	controller.register({ kind: 'viewport2d', key: 'view', label: () => 'View', available: () => available.value,
		spanAtZoomOne: () => 4, minimumZoom: () => 0.001, begin: () => null });
	controller.register({ key: 'position', label: () => 'Position', available: () => true, position: () => [0, 0], begin: () => null });
	controller.toggle('view'); available.value = false;
	assert.equal(controller.viewport.value, null);
	controller.toggle('position'); available.value = true;
	assert.equal(controller.isEnabled('view'), false);
	assert.equal(controller.viewport.value, null);
	assert.equal(controller.handles.value.length, 1);
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

// 【横長・縦長・表示倍率の異なるプレビューでも同じ相対移動とカーソル基準のズームを行う】
// レンダリングの解像度やCanvasのCSS倍率へ依存せず、回転を含めた参照平面の位置を保つ。
test('maps viewport navigation independently of preview aspect ratio and display scale', () => {
	for (const rect of [{ left: 40, top: 80, width: 800, height: 400 }, { left: -20, top: 10, width: 200, height: 400 }]) {
		const longSide = Math.max(rect.width, rect.height);
		const start = [rect.left + rect.width / 2, rect.top + rect.height / 2];
		const point = previewScreenToParameter([start[0] + longSide / 10, start[1] - longSide / 20], rect);
		const value = { center: [-0.743643887, 0.131825904], zoom: 1000, rotation: 0.25 };
		const panned = panPreviewViewport(value, point, 4);
		close(panned.center, [value.center[0] + 0.0002, value.center[1] - 0.0004]);
		const zoomed = zoomPreviewViewport(value, point, 2000, 4);
		close(zoomed.center, [value.center[0] - 0.0001, value.center[1] + 0.0002]);
	}
});

// 【Timelineの未設定structを一括更新し、Undoでは元の未設定状態へ戻す】
// 中心と倍率の中間状態を通知せず、プレビューで既定値を見ただけの保存値を増やさない。
test('updates viewport fields atomically on an effect layer and restores omitted values', () => {
	const f = fixture();
	f.state.timelineScenes.value = [{ id: 'scene', layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', effectParamValues: {} }] }];
	const layer = f.state.timelineScenes.value[0].layers[0];
	const notifications = [];
	f.manager.onChange(() => notifications.push(structuredClone(JSON.parse(JSON.stringify(layer.effectParamValues)))));
	const command = beginPreviewViewportBindingEdit(f.manager, { kind: 'timelineLayer', sceneId: 'scene', layerId: 'layer' }, null, 'effect', ['view']);
	const drag = preparePreviewViewportDrag(mandelbrot.paramDefs.view, structuredClone(mandelbrot.paramDefs.view.defaultValue), 500, 1000, command);
	drag.update({ ...drag.initialValue, center: [-0.743643887, 0.131825904], zoom: 1000 });
	drag.finish();
	assert.equal(notifications.length, 1);
	assert.deepEqual(notifications[0].view.value.center.value, [-0.743643887, 0.131825904]);
	assert.equal(notifications[0].view.value.zoom.value, 1000);
	assert.equal(f.manager.undoStack.value.length, 1);
	f.manager.undo(); assert.deepEqual(layer.effectParamValues, {});
	f.manager.redo(); assert.equal(layer.effectParamValues.view.value.zoom.value, 1000);
});

// 【戻した項目の追加キーだけを除き、変更中の別項目とキーIDを維持する】
// 中心と倍率を同じstructで編集しても、子ごとのキー・補間・加工式を独立して保存する。
test('restores unchanged viewport field bindings while retaining stable keys on changed fields', () => {
	const f = fixture();
	const def = mandelbrot.paramDefs.view;
	f.node.params.view = structuredClone(def.defaultValue);
	for (const key of ['center', 'zoom']) {
		const field = { ...def.fields[key], dataType: def.dataType.fields[key], ui: def.ui.control.fields[key] };
		f.node.params.view.value[key] = createInlineKeyframesTimeline(field, f.node.params.view.value[key]);
	}
	const before = JSON.parse(JSON.stringify(f.node.params.view));
	const command = beginPreviewViewportBindingEdit(f.manager, f.scope, 'node', null, ['view']);
	const drag = preparePreviewViewportDrag(def, JSON.parse(JSON.stringify(f.node.params.view)), 500, 1000, command);
	drag.update({ ...drag.initialValue, center: [-0.5000001, 0], zoom: 1000 });
	const zoomKeyId = f.node.params.view.value.zoom.keyframesTimeline.keyframes[1].id;
	drag.update({ ...drag.initialValue, zoom: 2000 }); drag.finish();
	assert.deepEqual(f.node.params.view.value.center, before.value.center);
	assert.equal(f.node.params.view.value.zoom.keyframesTimeline.keyframes[1].id, zoomKeyId);
	assert.equal(f.node.params.view.value.zoom.keyframesTimeline.keyframes[1].value, 2000);
	f.manager.undo(); assert.deepEqual(f.node.params.view, before);
	f.manager.redo(); assert.equal(f.node.params.view.value.zoom.keyframesTimeline.keyframes[1].id, zoomKeyId);
});

// 【Timeline上の表示範囲編集でも正規化キーの小数時刻を維持する】
// 通常のmsキーと同じ丸めをすると、追加した0.5や未変更の回転キーまで0・1へ移動してしまう。
test('preserves fractional normalized key times during timeline viewport edits', () => {
	const f = fixture();
	const def = mandelbrot.paramDefs.view;
	const view = structuredClone(def.defaultValue);
	for (const key of ['center', 'zoom', 'rotation']) {
		const field = { ...def.fields[key], dataType: def.dataType.fields[key], ui: def.ui.control.fields[key] };
		view.value[key] = createInlineKeyframesTimeline(field, view.value[key]);
		view.value[key].keyframesTimeline.isNormalized = true;
		view.value[key].keyframesTimeline.keyframes[0].x = 0.25;
		view.value[key].trimmedDurationMs = 1000;
	}
	f.state.timelineScenes.value = [{ id: 'scene', layers: [{ id: 'layer', layerType: 'effect', effectId: 'test', effectParamValues: { view } }] }];
	const layer = f.state.timelineScenes.value[0].layers[0];
	const command = beginPreviewViewportBindingEdit(f.manager, { kind: 'timelineLayer', sceneId: 'scene', layerId: 'layer' }, null, 'effect', ['view']);
	const drag = preparePreviewViewportDrag(def, view, 500, 1000, command);
	drag.update({ ...drag.initialValue, center: [-0.6, 0.1], zoom: 2 }); drag.finish();
	assert.deepEqual(layer.effectParamValues.view.value.center.keyframesTimeline.keyframes.map(point => point.x), [0.25, 0.5]);
	assert.deepEqual(layer.effectParamValues.view.value.zoom.keyframesTimeline.keyframes.map(point => point.x), [0.25, 0.5]);
	assert.deepEqual(layer.effectParamValues.view.value.rotation.keyframesTimeline.keyframes.map(point => point.x), [0.25]);
});

// 【回転の省略と、宣言された回転の欠損・駆動入力を区別する】
// 回転なしの表示範囲は操作できる一方、既存の回転式を0と決めつけて編集してはいけない。
test('defaults only undeclared viewport rotation to zero', () => {
	const def = magneticPendulum.paramDefs.view;
	const binding = structuredClone(def.defaultValue);
	assert.deepEqual(getPreviewViewportValue(def, binding, 0, 0), { center: [0, 0], zoom: 1, rotation: 0 });
	assert.equal(Object.hasOwn(binding.value, 'rotation'), false);
	const required = structuredClone(mandelbrot.paramDefs.view.defaultValue);
	delete required.value.rotation;
	assert.equal(getPreviewViewportValue(mandelbrot.paramDefs.view, required, 0, 0), null);
	required.value.rotation = { inputSource: 'expression', expression: 'TIME' };
	assert.equal(getPreviewViewportValue(mandelbrot.paramDefs.view, required, 0, 0), null);
});
