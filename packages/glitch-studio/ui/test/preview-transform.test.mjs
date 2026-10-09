import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	stdin: { contents: `
		export * from './src/utility/preview-transform.ts';
		export * from './src/utility/timeline-transform-edit.ts';
		export * from './src/utility/timeline-editor-state.ts';
		export { createInlineKeyframesTimeline } from './src/utility/keyframes-timeline.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createShapeTimelineLayer } from './src/utility/shape-timeline-layer.ts';
		export * from '@gs/subsystems_timeline_shared/layer-transform.ts';
		export { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts';
	`, resolveDir: directory, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'preview-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'stub' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({ contents: path === 'effects' ? 'export const effectDefinitions = {};'
			: 'export const preferences = { s: { forceTypeSafety: true } };', loader: 'ts' }));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { timelineSourceToScene, getTimelineLayerCorners, resizePreviewLayer, snapPreviewLayerMove, snapPreviewLayerResize,
	sceneToPreview, previewDeltaToScene, unwrapPreviewRotation, prepareTimelineTransformBindings, updateTimelineTransformBindings,
	canEditTimelineTransform, createInlineKeyframesTimeline, timelineCompositingParamDefs, UndoRedo, COMMAND_DEFS, createShapeTimelineLayer,
	getSelectedTimelineLayerId, getTimelineEditorState } = module.exports;

const geometry = (transform = {}, sourceSize = { width: 400, height: 400 }) => ({
	sourceSize, sceneSize: { width: 1600, height: 900 },
	transform: { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'contain', ...transform },
});
const near = (actual, expected) => actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} != ${expected}`));

// 【非正方形Sceneのfitと回転は画素空間の距離を保つ】
// 正規化座標をそのまま回すと、プレビューの枠だけが長方形Sceneで歪む。
test('maps fitted source bounds and clockwise rotation on a rectangular scene', () => {
	near(timelineSourceToScene([1, 1], geometry()), [0.5625, 1]);
	near(timelineSourceToScene([1, 1], geometry({ fitMode: 'cover' })), [1, 1600 / 900]);
	near(timelineSourceToScene([1, 0], geometry({ rotation: 0.5 })), [0, -1]);
	near(timelineSourceToScene([0.4, -0.6], geometry({ origin: [0.4, -0.6], position: [0.2, -0.1], rotation: 0.4 })), [0.2, -0.1]);
});

// 【回転・反転・中央以外の支点でも拡縮の反対側を固定する】
// positionとscaleの同時更新が必要になる条件を含め、目で見つけにくい座標のずれを防ぐ。
test('keeps the opposite corner fixed while resizing rotated and mirrored layers', () => {
	for (const fitMode of ['contain', 'cover', 'stretch']) for (const scale of [[1, 2], [-1, 2], [1, -2]]) {
		const initial = geometry({ fitMode, scale, origin: [0.4, -0.6], rotation: 0.37, position: [0.2, 0.3] });
		for (const keepRatio of [false, true]) {
			const result = resizePreviewLayer(initial, [1, 1], [0.1, -0.07], keepRatio, false);
			near(timelineSourceToScene([-1, -1], { ...initial, transform: result }), timelineSourceToScene([-1, -1], initial));
			if (keepRatio) assert.ok(Math.abs(result.scale[0] / result.scale[1] - scale[0] / scale[1]) < 1e-9);
		}
	}
});

// 【origin固定と辺ハンドルは必要な軸だけを変更する】
// 画面外のoriginや反転でも、片軸操作で他方の倍率や支点を動かさない。
test('preserves origin and the other scale axis for edge resizing', () => {
	const initial = geometry({ origin: [1.4, -0.8], rotation: 0.25, scale: [-2, 3] });
	const result = resizePreviewLayer(initial, [1, 0], [0.1, 0.3], false, true);
	near(result.position, initial.transform.position);
	assert.equal(result.scale[1], 3);
	assert.ok(result.scale[0] < 0);
	const clamped = resizePreviewLayer(geometry(), [1, 0], [-100, 0], false, false);
	assert.ok(clamped.scale[0] > 0);
});

// 【画面端へのスナップ距離はズーム後も画面上のpxで判定する】
// 素材解像度やScene座標の固定距離を使うと、拡大時と縮小時で操作感が変わる。
test('snaps frame edges with a screen pixel threshold and keeps the resize anchor', () => {
	const rect = { left: 100, top: 80, width: 800, height: 450 };
	const initial = geometry({ position: [0.43, 0], scale: [1, 0.5] });
	const snapped = snapPreviewLayerMove(initial, rect);
	assert.equal(Math.max(...getTimelineLayerCorners({ ...initial, transform: snapped }).map(point => point[0])), 1);
	const bigger = { ...rect, width: 8000, height: 4500 };
	near(snapPreviewLayerMove(initial, bigger).position, initial.transform.position);
	const start = geometry({ fitMode: 'stretch', scale: [0.5, 0.5] });
	const resized = resizePreviewLayer(start, [1, 1], [0.49, 0.49], true, false);
	const result = snapPreviewLayerResize(start, resized, [1, 1], true, false, rect);
	near(timelineSourceToScene([-1, -1], { ...start, transform: result }), [-0.5, -0.5]);
	near(timelineSourceToScene([1, 1], { ...start, transform: result }), [1, 1]);
});

// 【表示移動やズームを含む画面座標とScene座標を対応させる】
// 中ボタンでの表示移動を、レイヤーのpositionへ混入させない。
test('maps preview coordinates independently of pan and unwraps rotations across the branch cut', () => {
	near(sceneToPreview([0.5, -0.5], { left: 200, top: 100, width: 800, height: 400 }), [800, 400]);
	near(previewDeltaToScene([40, 20], { left: 200, top: 100, width: 800, height: 400 }), [0.1, -0.1]);
	assert.ok(Math.abs(unwrapPreviewRotation(Math.PI - 0.1, -Math.PI + 0.1) - 0.2) < 1e-9);
});

// 【親グループの拡大・縮小・非等方拡縮・回転でも吸着距離を画面上で一定にする】
// 子の座標系だけで距離を測ると、10倍の親で60px先へ吸着し、0.1倍の親では吸着しづらくなる。
// 入れ子の回転で子のX軸が祖先のY軸へ移る場合も、移動と辺ハンドルの両方で同じ閾値を守る。
test('uses screen distances through ancestor transforms for move and resize snapping', () => {
	const rect = { left: 100, top: 80, width: 800, height: 450 };
	const parent = transform => geometry({ fitMode: 'stretch', ...transform });
	const cases = [
		{ parents: [parent({ scale: [10, 10] })], pixelsPerX: 4000 },
		{ parents: [parent({ scale: [0.1, 0.1] })], pixelsPerX: 40 },
		{ parents: [parent({ scale: [10, 0.1], rotation: 0.27 }), parent({ scale: [-1, 1], rotation: 0.5 })], pixelsPerX: 40 },
	];
	for (const { parents, pixelsPerX } of cases) for (const distance of [5, 7]) {
		const initial = geometry({ fitMode: 'stretch', scale: [0.4, 0.3], position: [0.6 - distance / pixelsPerX, 0.13] });
		const moved = snapPreviewLayerMove(initial, rect, parents);
		const resized = snapPreviewLayerResize(initial, initial.transform, [1, 0], false, false, rect, parents);
		if (distance < 6) {
			near(timelineSourceToScene([1, 0], { ...initial, transform: moved }), [1, 0.13]);
			near(timelineSourceToScene([1, 0], { ...initial, transform: resized }), [1, 0.13]);
			near(timelineSourceToScene([-1, 0], { ...initial, transform: resized }), timelineSourceToScene([-1, 0], initial));
		} else {
			assert.deepEqual(moved, initial.transform);
			assert.deepEqual(resized, initial.transform);
		}
	}
});

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const layer = createShapeTimelineLayer('rectangle', 0);
	layer.id = 'layer';
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] };
	const history = new UndoRedo({ timelineScenes: { value: [scene] } }, COMMAND_DEFS);
	const update = bindings => ({ sceneId: 'scene', layerId: 'layer', bindings });
	return { layer, scene, history, update };
}

// 【一回のドラッグで位置と倍率を一括Undoし、Redoで最終値へ戻す】
// 単一パラメータのmergeKeyを交互に使うと一方の変更が履歴から失われるため、実Commandで確認する。
test('commits all transform fields as a single reversible edit', t => {
	const { layer, history, update } = fixture(t);
	const before = structuredClone(layer.compositingParamValues);
	const prepared = prepareTimelineTransformBindings(before, ['position', 'scale'], 0);
	const session = history.beginEdit('editTimelineLayerTransform');
	for (const x of [0.2, 0.4, 0.8]) session.update(update(updateTimelineTransformBindings(prepared, geometry({ position: [x, 0], scale: [2, 3] }).transform, 0)));
	assert.equal(history.undoStack.value.length, 0);
	session.finish();
	assert.equal(history.undoStack.value.length, 1);
	history.undo();
	assert.deepEqual(layer.compositingParamValues, before);
	history.redo();
	assert.deepEqual(layer.compositingParamValues.position.value, [0.8, 0]);
	assert.deepEqual(layer.compositingParamValues.scale.value, [2, 3]);
});

// 【Esc相当の取消では値・キー・Undo/Redo履歴を開始前に戻す】
// 一時変更のcommitでRedoを破棄すると、キャンセルしただけで既存の編集を失ってしまう。
test('cancels staged edits without losing redo or creating a history entry', t => {
	const { layer, history, update } = fixture(t);
	history.commit('editTimelineLayerTransform', update({ rotation: { inputSource: 'literal', value: 0.5 } }));
	history.undo();
	const before = structuredClone(layer.compositingParamValues);
	const session = history.beginEdit('editTimelineLayerTransform');
	session.update(update({ position: { inputSource: 'literal', value: [1, 1] } }));
	session.cancel();
	assert.deepEqual(layer.compositingParamValues, before);
	assert.equal(history.undoStack.value.length, 0);
	assert.equal(history.redoStack.value.length, 1);
	history.redo();
	assert.equal(layer.compositingParamValues.rotation.value, 0.5);
});

// 【新規キーのID・補間を維持し、既存の同時刻キーは上書きする】
// ドラッグのたびに新しいIDを発行したり、既存キーを重複作成すると選択やUndoが壊れる。
test('inserts one key at rounded scene time and preserves existing keys and interpolation', t => {
	const { layer, history, update } = fixture(t);
	const binding = createInlineKeyframesTimeline(timelineCompositingParamDefs.position);
	binding.keyframesTimeline.keyframes[0].interpolation = { type: 'ease:quad', direction: 'inOut' };
	layer.compositingParamValues.position = binding;
	const before = structuredClone(binding);
	const prepared = prepareTimelineTransformBindings(layer.compositingParamValues, ['position'], 500.4);
	const newId = prepared.position.keyframesTimeline.keyframes[1].id;
	const session = history.beginEdit('editTimelineLayerTransform');
	for (const x of [0.2, 0.4]) session.update(update(updateTimelineTransformBindings(prepared, geometry({ position: [x, 0] }).transform, 500)));
	session.finish();
	const keys = layer.compositingParamValues.position.keyframesTimeline.keyframes;
	assert.deepEqual(keys.map(key => key.x), [0, 500]);
	assert.equal(keys[1].id, newId);
	assert.deepEqual(keys[1].interpolation, before.keyframesTimeline.keyframes[0].interpolation);
	history.undo();
	assert.deepEqual(layer.compositingParamValues.position, before);
	history.redo();
	const again = prepareTimelineTransformBindings(layer.compositingParamValues, ['position'], 500);
	assert.equal(again.position.keyframesTimeline.keyframes.length, 2);
	assert.equal(again.position.keyframesTimeline.keyframes[1].id, newId);
});

// 【式は保持し、操作途中の別編集を古いドラッグで巻き戻さない】
// 他パネルの編集やレイヤー削除が入った場合、終了済みセッションからの更新・取消を無効にする。
test('keeps driven bindings read only and ends a drag before another command', t => {
	assert.equal(canEditTimelineTransform({ inputSource: 'expression', expression: 'TIME' }, 'rotation'), false);
	assert.throws(() => prepareTimelineTransformBindings({ rotation: { inputSource: 'expression', expression: 'TIME' } }, ['rotation'], 0));
	const { layer, history, update } = fixture(t);
	const session = history.beginEdit('editTimelineLayerTransform');
	session.update(update({ rotation: { inputSource: 'literal', value: 0.5 } }));
	history.commit('editTimelineLayerTransform', update({ rotation: { inputSource: 'literal', value: 1 } }));
	session.cancel();
	assert.equal(layer.compositingParamValues.rotation.value, 1);
	assert.equal(session.active, false);
	history.undo();
	assert.equal(layer.compositingParamValues.rotation.value, 0.5);
});

// 【同じレイヤーの複数クリップ・キーだけを単一の操作対象にする】
// タイムラインとプレビューが別々に選択を保持すると、意図と違うレイヤーを変形してしまう。
test('shares scene selection and resolves one distinct selected layer', t => {
	const { scene } = fixture(t);
	const first = getTimelineEditorState(scene);
	assert.equal(getTimelineEditorState(scene), first);
	first.selection = { kind: 'clips', clips: [{ layerId: 'a', clipId: 'one' }, { layerId: 'a', clipId: 'two' }] };
	assert.equal(getSelectedTimelineLayerId(first.selection), 'a');
	assert.equal(getSelectedTimelineLayerId({ kind: 'layers', ids: ['a', 'b'] }), null);
	assert.equal(getSelectedTimelineLayerId({ kind: 'keyframes', keyframes: [{ layerId: 'a' }, { layerId: 'a' }] }), 'a');
});

// 【未設定項目を維持し、不正な一括更新は全体を拒否する】
// origin固定へ切り替えたときに位置を明示保存せず、倍率の検証失敗で位置だけを保存しない。
test('restores untouched bindings within a drag and validates the complete update before applying', t => {
	const { layer, history, update } = fixture(t);
	delete layer.compositingParamValues.position;
	const session = history.beginEdit('editTimelineLayerTransform');
	session.update(update({ position: { inputSource: 'literal', value: [1, 0] }, scale: { inputSource: 'literal', value: [2, 2] } }));
	session.update(update({ position: undefined, scale: { inputSource: 'literal', value: [3, 3] } }));
	session.finish();
	assert.equal(layer.compositingParamValues.position, undefined);
	history.undo();
	assert.equal(layer.compositingParamValues.position, undefined);
	assert.deepEqual(layer.compositingParamValues.scale.value, [1, 1]);
	history.redo();
	assert.equal(layer.compositingParamValues.position, undefined);
	assert.deepEqual(layer.compositingParamValues.scale.value, [3, 3]);
	const before = structuredClone(layer.compositingParamValues);
	assert.throws(() => history.commit('editTimelineLayerTransform', update({ position: { inputSource: 'literal', value: [1, 0] }, scale: { inputSource: 'literal', value: [NaN, 1] } })));
	assert.deepEqual(layer.compositingParamValues, before);
});
