import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/timeline-selection.ts'; export * from './src/utility/timeline-snapping.ts'; export * from './src/utility/timeline-ticks.ts'; export { AppStateManager } from './src/AppStateManager.ts'; export { listenPointerDrag } from './src/utility/pointer-drag.ts';",
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
const { selectTimelineRange, selectionRect, timelineMarqueeRect, keyframeSelectionKey, constrainTimelineMove, keyframeMoveBounds, AppStateManager, listenPointerDrag } = module.exports;
const { getTimelineSnapCandidates, getTimelineSnappingTimes, getTimelineSeekPosition, getTimelineLocalTicks, getTimelineLayerTicks, formatTimelineTimecode } = module.exports;

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

// 【ポインターが静止していてもスクロールで選択範囲を更新する】
// 開始時点ですでにスクロールしている場合も、開始点をコンテンツ上に固定する。
// 表示領域の外へ出た開始点を残すことで、上下どちらへのスクロールでも範囲が正しく伸縮する。
test('anchors the marquee to content while scrolling with a stationary pointer', () => {
	const viewport = { left: 100, top: 50, right: 400, bottom: 250 };
	const origin = { x: 20, y: 100 };
	const pointer = { x: 180, y: 180 };
	assert.deepEqual(timelineMarqueeRect(origin, pointer, viewport, 40), { left: 120, top: 110, right: 180, bottom: 180 });
	assert.deepEqual(timelineMarqueeRect(origin, pointer, viewport, 180), { left: 120, top: -30, right: 180, bottom: 180 });
	assert.deepEqual(timelineMarqueeRect(origin, pointer, viewport, 40), { left: 120, top: 110, right: 180, bottom: 180 });
	assert.deepEqual(timelineMarqueeRect({ x: 20, y: 300 }, { x: 180, y: 100 }, viewport, 0), { left: 120, top: 100, right: 180, bottom: 350 });
	assert.deepEqual(timelineMarqueeRect(origin, { x: 500, y: 500 }, viewport, 180), { left: 120, top: -30, right: 400, bottom: 250 });
});

// 【スクロールで画面外へ出たレイヤー・キーも範囲内なら選択を維持する】
// 表示中の対象だけを判定すると、スクロールのたびに先に囲んだ対象が選択から抜けてしまう。
// 戻すと範囲から外れた対象は解除し、Shiftで引き継いだ選択だけは残す。
test('retains offscreen selections and removes them when scrolling shrinks the range', () => {
	const viewport = { left: 100, top: 50, right: 400, bottom: 250 };
	const origin = { x: 20, y: 100 };
	const pointer = { x: 180, y: 180 };
	const content = [{ id: 'first', y: 115 }, { id: 'second', y: 250 }, { id: 'outside', y: 350 }];
	for (const scrollTop of [40, 180, 40]) {
		const rect = timelineMarqueeRect(origin, pointer, viewport, scrollTop);
		const expectedIds = scrollTop === 180 ? ['first', 'second'] : ['first'];
		const clips = content.map(({ id, y }) => ({ id, rect: { left: 130, right: 150, top: viewport.top + y - scrollTop - 10, bottom: viewport.top + y - scrollTop + 10 } }));
		const keyframes = content.map(({ id, y }) => ({ selection: key(id, 'point'), x: 140, y: viewport.top + y - scrollTop }));
		assert.deepEqual(selectTimelineRange(rect, { clips, keyframes }, empty, false), { kind: 'layers', ids: expectedIds });
		assert.deepEqual(selectTimelineRange(rect, { clips: [], keyframes }, empty, false), { kind: 'keyframes', keyframes: expectedIds.map(id => key(id, 'point')) });
		assert.deepEqual(selectTimelineRange(rect, { clips, keyframes }, { kind: 'keyframes', keyframes: [key('old', 'point')] }, true), {
			kind: 'keyframes', keyframes: [key('old', 'point'), ...expectedIds.map(id => key(id, 'point'))],
		});
	}
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

// 【ローカル目盛りは表示範囲とレイヤーの配置時刻から生成する】
// グローバル目盛りのラベルだけを引き算するとローカル0が目盛りにならないため、ローカル時間軸で刻む。
// パン・レイヤー移動・ズーム後も基準を保ち、トリム量を時間原点として使わないことを確認する。
test('generates local ticks around the layer origin across panning and zooming', () => {
	assert.deepEqual(getTimelineLocalTicks(1234, 0, 4000, 5), [-2000, -1000, 0, 1000, 2000, 3000]);
	assert.deepEqual(getTimelineLocalTicks(2334, 1100, 4000, 5), [-2000, -1000, 0, 1000, 2000, 3000]);
	assert.deepEqual(getTimelineLocalTicks(1234, 1234, 2000, 5), [0, 500, 1000, 1500, 2000]);
	const trimmedLayer = { positionMs: -200, trimStartMs: 700 };
	const ticks = getTimelineLocalTicks(trimmedLayer.positionMs, 0, 1000, 6);
	assert.deepEqual(ticks, [200, 400, 600, 800, 1000, 1200]);
	assert.equal(formatTimelineTimecode(trimmedLayer.trimStartMs), '0:00.7');
	assert.deepEqual(getTimelineLocalTicks(0, 0, 0, 15), []);
});

// 【主目盛りと補助目盛りはトリム後の表示区間内に限定する】
// ローカル時刻の原点は変えず、負の時刻・トリムで隠れた時刻・終了時刻以降を表示も吸着もさせない。
test('limits local ruler ticks to the visible layer interval', () => {
	assert.deepEqual(getTimelineLayerTicks({ positionMs: 1234, trimStartMs: 0, trimmedDurationMs: 2000 }, 0, 4000, 5), {
		major: [0, 1000], minor: [500, 1500],
	});
	assert.deepEqual(getTimelineLayerTicks({ positionMs: -200, trimStartMs: 700, trimmedDurationMs: 600 }, 0, 1000, 6), {
		major: [800, 1000, 1200], minor: [700, 900, 1100],
	});
	assert.deepEqual(getTimelineLayerTicks({ positionMs: 6000, trimStartMs: 0, trimmedDurationMs: 1000 }, 0, 1000, 6), {
		major: [], minor: [],
	});
});

// 【主目盛りを含まない短い表示区間でも補助目盛りを残す】
// 主目盛りを先に絞ってから中間目盛りを作ると、区間内にある500msの補助目盛りが消えてしまう。
test('preserves minor ticks near clipped ends and in short layers', () => {
	assert.deepEqual(getTimelineLayerTicks({ positionMs: 0, trimStartMs: 250, trimmedDurationMs: 300 }, 0, 4000, 5), {
		major: [], minor: [500],
	});
	assert.deepEqual(getTimelineLayerTicks({ positionMs: 0, trimStartMs: 500, trimmedDurationMs: 500 }, 0, 4000, 5), {
		major: [], minor: [500],
	});
});

// 【シークバーは追加オプションと全体・グローバル設定が有効なときだけ目盛りへ吸着する】
// キーのローカル設定が有効でもシークバーの候補には影響させず、OFFでは通常のシーク位置を維持する。
test('snaps seeking to global ticks only when all applicable switches are enabled', () => {
	for (const enabled of [false, true]) {
		for (const globalTicks of [false, true]) {
			for (const seekBar of [false, true]) {
				const candidates = seekBar ? getTimelineSnapCandidates({ enabled, globalTicks, localTicks: true }, [], [0, 1000, 2000]) : [];
				assert.deepEqual(getTimelineSeekPosition(998, 3000, candidates, 1), enabled && globalTicks && seekBar
					? { timeMs: 1000, snappingTime: 1000 } : { timeMs: 998, snappingTime: null });
			}
		}
	}
	assert.deepEqual(getTimelineSeekPosition(980, 3000, [1000], 1), { timeMs: 980, snappingTime: null });
	assert.deepEqual(getTimelineSeekPosition(980, 3000, [1000], 10), { timeMs: 1000, snappingTime: 1000 });
});

// 【吸着候補が再生区間外ならシークせず、空のタイムラインも負の時刻にしない】
// 終了時刻への吸着を後からクランプすると、実際には一致しない目盛りにガイドが出てしまうため候補段階で除外する。
test('keeps seeking inside playback bounds before choosing a snap target', () => {
	assert.deepEqual(getTimelineSeekPosition(1998, 2000, [2000], 1), { timeMs: 1998, snappingTime: null });
	assert.deepEqual(getTimelineSeekPosition(2500, 2000, [2000], 1), { timeMs: 1999, snappingTime: null });
	assert.deepEqual(getTimelineSeekPosition(-10, 2000, [-10], 1), { timeMs: 0, snappingTime: null });
	assert.deepEqual(getTimelineSeekPosition(100, 0, [], 1), { timeMs: 0, snappingTime: null });
});

// 【レイヤーの前方にある負の時刻と短いミリ秒値も正しく表示する】
// 0より前を表示しても秒・分にそれぞれ負号を付けず、50msを500msと誤認させない。
test('formats signed local ruler labels and fractional seconds', () => {
	assert.equal(formatTimelineTimecode(-61500), '-1:01.5');
	assert.equal(formatTimelineTimecode(-50), '-0:00.05');
	assert.equal(formatTimelineTimecode(5), '0:00.005');
	assert.equal(formatTimelineTimecode(1000), '0:01');
	assert.equal(formatTimelineTimecode(0), '0:00');
});

// 【全体・グローバル・ローカルのスイッチを独立して組み合わせる】
// 全体OFFはクリップ端・再生位置等も無効化するが、個別スイッチは目盛りだけに作用する。
// 設定値を変更せず候補を組み立てるため、全体を再度ONにしても以前の組み合わせが残る。
test('applies all snap settings combinations without changing their values', () => {
	for (const enabled of [false, true]) {
		for (const globalTicks of [false, true]) {
			for (const localTicks of [false, true]) {
				const settings = { enabled, globalTicks, localTicks };
				const before = { ...settings };
				const expected = enabled ? [120, ...(globalTicks ? [500] : []), ...(localTicks ? [650] : [])] : [];
				assert.deepEqual(getTimelineSnapCandidates(settings, [120, 120], [500], [650]), expected);
				assert.deepEqual(settings, before);
				const clipCandidates = getTimelineSnapCandidates(settings, [120], [500]);
				assert.deepEqual(clipCandidates, enabled ? [120, ...(globalTicks ? [500] : [])] : []);
			}
		}
	}
});

// 【両方の目盛りが有効なら最も近い候補へ吸着する】
// ローカル目盛りを有効化してもグローバル候補を排除せず、同じ候補は重複させない。
test('chooses the nearest tick when global and local snapping are both enabled', () => {
	const settings = { enabled: true, globalTicks: true, localTicks: true };
	const candidates = getTimelineSnapCandidates(settings, [], [500], [500, 503]);
	assert.deepEqual(candidates, [500, 503]);
	const points = [{ time: 497, minDelta: -497, maxDelta: Infinity, snapTimes: candidates }];
	assert.deepEqual(constrainTimelineMove(5, points, [], 1), { delta: 6, snappingTime: 503 });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 6), [503]);
});

// 【複数レイヤーのキーは自分のレイヤーのローカル目盛りだけを参照する】
// 全レイヤーのローカル候補をひとつにまとめると、別レイヤーの位相に誤って吸着する。
// 一括移動量は共通のまま、吸着・ガイド線の両方で候補の所属を守る。
test('keeps local snap candidates scoped to each moving keyframe', () => {
	const points = [
		{ time: 643, minDelta: -100, maxDelta: 100, snapTimes: [500] },
		{ time: 590, minDelta: -100, maxDelta: 100, snapTimes: [650] },
	];
	assert.deepEqual(constrainTimelineMove(6, points, [650], 1), { delta: 6, snappingTime: null });
	assert.deepEqual(getTimelineSnappingTimes(points, [650], 7), []);
	points[0].time = 493;
	assert.deepEqual(constrainTimelineMove(6, points, [], 1), { delta: 7, snappingTime: 500 });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 7), [500]);
});

// 【ローカルスナップでもグループ全体の移動制限と全一致位置の表示を保つ】
// 別のキーの移動限界を越える候補には吸着せず、同じ移動量で一致した目盛りは全て表示する。
test('respects group bounds and displays every matching scoped snap position', () => {
	const points = [
		{ time: 497, minDelta: -100, maxDelta: 100, snapTimes: [500, 500] },
		{ time: 647, minDelta: -100, maxDelta: 2, snapTimes: [650] },
	];
	assert.deepEqual(constrainTimelineMove(3, points, [], 1), { delta: 2, snappingTime: null });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 2), []);
	points[1].maxDelta = 100;
	assert.deepEqual(constrainTimelineMove(3, points, [], 1), { delta: 3, snappingTime: 500 });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 3), [500, 650]);
	for (const point of points) point.snapTimes = getTimelineSnapCandidates({ enabled: false, globalTicks: true, localTicks: true }, [0], [500], [650]);
	assert.deepEqual(constrainTimelineMove(3, points, [], 1), { delta: 3, snappingTime: null });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 3), []);
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
