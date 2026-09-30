import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/timeline-selection.ts'; export { AppStateManager } from './src/AppStateManager.ts'; export { listenPointerDrag } from './src/utility/pointer-drag.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{
		name: 'timeline-selection-dependencies',
		setup(build) {
			// Commandと履歴は本物を使い、今回無関係なエフェクト登録・設定ストレージだけを除く。
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
			build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
			build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'effects'
				? 'export const effectDefinitions = {};'
				: 'export const preferences = { s: { forceTypeSafety: false } };', loader: 'ts' }));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { selectTimelineRange, selectionRect, keyframeSelectionKey, constrainTimelineMove, keyframeMoveBounds, AppStateManager, listenPointerDrag } = module.exports;

const key = (layerId, keyframeId, target = 'audio', paramId = 'volume') => ({ layerId, target, paramId, keyframeId });
const empty = { kind: 'layers', ids: [] };
const geometry = {
	clips: [{ id: 'long', rect: { left: -1000, top: 0, right: 1000, bottom: 20 } }, { id: 'short', rect: { left: 30, top: 50, right: 60, bottom: 70 } }],
	keyframes: [{ selection: key('long', 'a'), x: 10, y: 30 }, { selection: key('short', 'b'), x: 50, y: 80 }],
};

// 【一部だけ重なる長いクリップも選び、キーよりレイヤーを優先する】
// クリップ全体を囲めないズーム倍率でも選択でき、上下左右どちら向きのドラッグでも結果が揃う必要がある。
test('selects intersecting clips before keyframes in every drag direction', () => {
	for (const [x1, y1, x2, y2] of [[0, 10, 55, 85], [55, 85, 0, 10], [0, 85, 55, 10], [55, 10, 0, 85]]) {
		assert.deepEqual(selectTimelineRange(selectionRect(x1, y1, x2, y2), geometry, empty, false), { kind: 'layers', ids: ['long', 'short'] });
	}
});

// 【キーは中心点で判定し、通常選択では以前の選択を置き換える】
// ノブの大きさやCSSの変更で選択判定が変わらないよう、境界上の中心を含み、外れた中心を除く。
test('selects keyframe centers inclusively and replaces previous selection', () => {
	assert.deepEqual(selectTimelineRange(selectionRect(10, 30, 20, 40), geometry, { kind: 'layers', ids: ['old'] }, false), { kind: 'keyframes', keyframes: [key('long', 'a')] });
	assert.deepEqual(selectTimelineRange(selectionRect(11, 30, 20, 40), geometry, { kind: 'keyframes', keyframes: [key('long', 'a')] }, false), { kind: 'keyframes', keyframes: [] });
});

// 【Shiftで種類を維持し、同じ対象を重複追加しない】
// キーを追加する途中でクリップを囲んでも既存のキーを失わず、レイヤー選択中はキーだけを囲んでも種類を変えない。
test('adds only the existing selection kind and deduplicates identities', () => {
	const all = selectionRect(-10, -10, 100, 100);
	assert.deepEqual(selectTimelineRange(all, geometry, { kind: 'keyframes', keyframes: [key('long', 'a')] }, true), { kind: 'keyframes', keyframes: [key('long', 'a'), key('short', 'b')] });
	assert.deepEqual(selectTimelineRange(all, geometry, { kind: 'layers', ids: ['long'] }, true), { kind: 'layers', ids: ['long', 'short'] });
	assert.deepEqual(selectTimelineRange(selectionRect(0, 25, 20, 35), geometry, { kind: 'layers', ids: ['short'] }, true), { kind: 'layers', ids: ['short'] });
	assert.deepEqual(selectTimelineRange(all, geometry, empty, true), { kind: 'layers', ids: ['long', 'short'] });
	assert.notEqual(keyframeSelectionKey(key('long', 'a')), keyframeSelectionKey(key('short', 'a')));
});

// 【囲む範囲を縮めたときは途中で選択した対象を残さない】
// 各更新をドラッグ開始時の選択へ適用することで、追加選択でも今回のドラッグで一度触れただけの対象は解除できる。
test('shrinks the marquee against its initial selection', () => {
	const previous = { kind: 'layers', ids: ['old'] };
	assert.deepEqual(selectTimelineRange(selectionRect(0, 0, 100, 100), geometry, previous, true).ids, ['old', 'long', 'short']);
	assert.deepEqual(selectTimelineRange(selectionRect(0, 0, 20, 10), geometry, previous, true).ids, ['old', 'long']);
	assert.deepEqual(previous.ids, ['old']);
});

// 【レイヤー全体で移動量を制限し、吸着も同じ量だけ適用する】
// 個別に0へ丸めるとレイヤー間隔が崩れる。範囲外の吸着候補よりグループ全体の移動可能範囲を優先する。
test('clamps and snaps one shared delta without changing layer spacing', () => {
	const points = [{ time: 100, minDelta: -100, maxDelta: Infinity }, { time: 500, minDelta: -500, maxDelta: Infinity }];
	assert.deepEqual(constrainTimelineMove(-200, points, [], 1), { delta: -100, snappingTime: null });
	assert.deepEqual(constrainTimelineMove(97, points, [600], 1), { delta: 100, snappingTime: 600 });
	assert.deepEqual(constrainTimelineMove(-103, points, [-3], 1), { delta: -100, snappingTime: null });
	assert.deepEqual(constrainTimelineMove(97, points, [606], 1), { delta: 97, snappingTime: null });
	assert.equal(constrainTimelineMove(97, points, [606], 2).delta, 106);
});

// 【選択したキー同士は移動を妨げず、未選択の隣接キーは越えない】
// 連続する複数キーだけでなく、間に未選択キーがある場合も同じ移動量を制限して順序を保つ。
test('constrains keyframes against unselected neighbors and local time zero', () => {
	const points = [0, 100, 200, 300].map(x => ({ id: String(x), x }));
	const selected = new Set(['100', '200']);
	const bounds = ['100', '200'].map(id => keyframeMoveBounds(points, selected, id));
	assert.deepEqual(bounds, [{ minDelta: -100, maxDelta: 200 }, { minDelta: -200, maxDelta: 100 }]);
	assert.equal(constrainTimelineMove(250, bounds.map((bound, index) => ({ ...bound, time: 1000 + index * 100 })), [], 1).delta, 100);
	assert.deepEqual(keyframeMoveBounds(points, new Set(['0', '200']), '0'), { minDelta: 0, maxDelta: 100 });
	assert.deepEqual(keyframeMoveBounds(points, new Set(['0', '200']), '200'), { minDelta: -100, maxDelta: 100 });
	assert.deepEqual(keyframeMoveBounds(points, new Set(points.map(point => point.id)), '100'), { minDelta: -100, maxDelta: Infinity });
});

function fixture() {
	const manager = new AppStateManager();
	const binding = () => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: 1000,
		keyframesTimeline: { dataType: { kind: 'scalar' }, keyframes: [100, 200, 800].map((x, index) => ({ id: String(index), x, value: [index], interpolation: { type: 'linear' } })) } });
	manager.state.timelineScenes.value = [{ id: 'scene', name: 'Scene', layers: [
		{ id: 'audio', layerType: 'audio', positionMs: -100, trimStartMs: 200, trimmedDurationMs: 1000, assetId: 'sound', paramValues: { volume: binding() }, automationGraphs: [] },
		{ id: 'video', layerType: 'video', positionMs: 1000, trimStartMs: 50, trimmedDurationMs: 2000, assetId: 'movie', fitMode: 'contain', audioEnabled: true,
			compositingParamValues: { opacity: binding() }, audioParamValues: { volume: binding() }, automationGraphs: [] },
	] }];
	return manager;
}
const layers = manager => manager.state.timelineScenes.value[0].layers;
const snapshot = manager => JSON.parse(JSON.stringify(layers(manager)));

// 【一括レイヤー移動を1回のUndoで戻し、同じ結果へRedoする】
// ドラッグの更新回数にかかわらず履歴を1件にまとめ、素材のトリムやパラメータ値を変更しない。
test('undoes and redoes a multi-layer drag as one history entry', () => {
	const manager = fixture();
	const before = snapshot(manager);
	for (const delta of [20, 60, 100]) manager.commit('moveTimelineLayers', { sceneId: 'scene', positions: before.map(layer => ({ layerId: layer.id, positionMs: layer.positionMs + delta })) }, 'drag');
	assert.equal(manager.undoStack.value.length, 1);
	const after = before.map(layer => ({ ...layer, positionMs: layer.positionMs + 100 }));
	assert.deepEqual(snapshot(manager), after);
	for (let i = 0; i < 2; i++) {
		manager.undo();
		assert.deepEqual(snapshot(manager), before);
		manager.redo();
		assert.deepEqual(snapshot(manager), after);
	}
});

// 【複数レイヤー・複数パラメータのキーを一括で移動し復元する】
// レイヤーの配置時刻が異なっても同じ差分で動かし、未選択キー・値・補間設定を保つ。
test('moves keyframes across layers and parameters in one undoable command', () => {
	const manager = fixture();
	const before = snapshot(manager);
	const selected = [key('audio', '0'), key('audio', '1'), key('video', '0', 'compositing', 'opacity'), key('video', '1')];
	for (const delta of [30, 50]) manager.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: selected.map(point => ({ ...point, x: (point.keyframeId === '0' ? 100 : 200) + delta })) }, 'keys');
	assert.equal(manager.undoStack.value.length, 1);
	const after = snapshot(manager);
	assert.deepEqual(after[0].paramValues.volume.keyframesTimeline.keyframes.map(point => point.x), [150, 250, 800]);
	assert.deepEqual(after[1].compositingParamValues.opacity.keyframesTimeline.keyframes.map(point => point.x), [150, 200, 800]);
	assert.deepEqual(after[1].audioParamValues.volume.keyframesTimeline.keyframes.map(point => point.x), [100, 250, 800]);
	assert.deepEqual(after.map(layer => layer.positionMs), before.map(layer => layer.positionMs));
	for (let i = 0; i < 2; i++) {
		manager.undo();
		assert.deepEqual(snapshot(manager), before);
		manager.redo();
		assert.deepEqual(snapshot(manager), after);
	}
});

// 【一括変更の後半が不正でも前半だけを変更しない】
// 対象削除や不正な移動量が混じった場合、履歴に残らない部分変更を防ぐため全件を事前検証する。
test('rejects invalid batch moves atomically', () => {
	const manager = fixture();
	const before = snapshot(manager);
	assert.throws(() => manager.commit('moveTimelineLayers', { sceneId: 'scene', positions: [{ layerId: 'audio', positionMs: 0 }, { layerId: 'video', positionMs: -100 }] }), /Invalid layer move/);
	assert.throws(() => manager.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...key('audio', '0'), x: 150 }, { ...key('video', 'missing'), x: 200 }] }), /Timeline keyframe not found/);
	assert.throws(() => manager.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...key('audio', '0'), x: -1 }] }), /Invalid keyframe move/);
	assert.deepEqual(snapshot(manager), before);
	assert.equal(manager.undoStack.value.length, 0);
});

// 【別ポインターを無視し、終了・キャンセル・フォーカス喪失時に監視を解除する】
// Pointer CaptureのライフサイクルだけをEventTargetで再現するため、DOMの階層やレイアウトに依存しない。
// 最後のpointerup座標も反映し、ドラッグ後やアンマウント後に移動を受け続けないことを確認する。
test('cleans up pointer drags on release, cancellation, lost capture, blur and disposal', t => {
	const originalWindow = globalThis.window;
	t.after(() => { globalThis.window = originalWindow; });
	for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'dispose']) {
		globalThis.window = new EventTarget();
		const element = new EventTarget();
		let captured = false;
		element.setPointerCapture = () => { captured = true; };
		element.hasPointerCapture = () => captured;
		element.releasePointerCapture = () => { captured = false; };
		const moves = [];
		let ended = 0;
		const stop = listenPointerDrag({ pointerId: 1, currentTarget: element }, event => moves.push(event.clientX), () => ended++);
		const dispatch = (target, type, pointerId, clientX) => target.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX }));
		dispatch(window, 'pointermove', 2, 10);
		dispatch(window, 'pointerup', 2, 20);
		dispatch(window, 'pointermove', 1, 30);
		if (ending === 'dispose') stop();
		else dispatch(ending === 'lostpointercapture' ? element : window, ending, 1, 40);
		dispatch(window, 'pointermove', 1, 50);
		stop();
		assert.deepEqual(moves, ending === 'pointerup' ? [30, 40] : [30]);
		assert.equal(ended, 1);
		assert.equal(captured, false);
	}
});
