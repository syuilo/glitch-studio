import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/timeline-selection.ts'; export * from './src/utility/timeline-marquee.ts'; export * from './src/utility/timeline-snapping.ts'; export * from './src/utility/timeline-ticks.ts'; export * from './src/utility/timeline-keyframe-stretch.ts'; export * from './src/utility/timeline-zoom.ts'; export { ProjectContext } from './src/Project.ts'; export { listenPointerDrag } from './src/utility/pointer-drag.ts';",
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
const { selectTimelineRange, selectionRect, timelineMarqueeRect, keyframeSelectionKey, getTimelineStretchSelection, constrainTimelineMove, keyframeMoveBounds, ProjectContext, listenPointerDrag } = module.exports;
const { getTimelineSnapCandidates, getTimelineSnappingTimes, getTimelineSeekPosition, getTimelineLocalTicks, getTimelineClipTicks, formatTimelineTimecode } = module.exports;
const { createKeyframeStretch, stretchKeyframeX, zoomTimelineX } = module.exports;

const { measureTimelineLayerSelection, collectTimelineMarqueeCandidates, timelineLaneKey, mergeTimelineRangeSelection } = module.exports;

// 【拡大縮小してもカーソル直下の時刻を維持する】
// 横スクロール済みの状態や左右端でも、ズーム操作によって注目している時刻を見失わないようにする。
// 大きなホイール量で時間軸が反転・消失しないことも確認する。
test('zooms around the pointer time and keeps a positive finite range', () => {
	for (const ratio of [0, 0.3, 1]) {
		for (const delta of [-120, 120]) {
			const zoomed = zoomTimelineX(-3000, 30000, ratio, delta);
			assert.equal(zoomed.start + zoomed.range * ratio, -3000 + 30000 * ratio);
			assert.equal(zoomed.range > 30000, delta > 0);
			const restored = zoomTimelineX(zoomed.start, zoomed.range, ratio, -delta);
			assert.ok(Math.abs(restored.range - 30000) < 1e-8);
			assert.ok(Math.abs(restored.start + 3000) < 1e-8);
		}
	}
	for (const delta of [-1e6, 1e6]) {
		const zoomed = zoomTimelineX(0, 30000, 0.5, delta);
		assert.ok(zoomed.range > 0 && Number.isFinite(zoomed.range) && Number.isFinite(zoomed.start));
	}
});

// 【先頭・末尾から反対端を固定して全キーの間隔の比率を維持する】
// 保存順序に依存せず、拡大・縮小・元の位置への復帰を開始時のスナップショットから計算する。
// 値や補間方法を変更せずにタイミングだけ調整するための仕様。
test('stretches either endpoint proportionally without mutating the original keys', () => {
	const keyframes = [{ id: 'last', x: 500 }, { id: 'first', x: 100 }, { id: 'middle', x: 200 }];
	const before = structuredClone(keyframes);
	const first = createKeyframeStretch(keyframes, 'first');
	const last = createKeyframeStretch(keyframes, 'last');
	assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, first, 200)), [500, 300, 350]);
	assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, first, -100)), [500, 0, 125]);
	assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, last, 400)), [900, 100, 300]);
	assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, last, -200)), [300, 100, 150]);
	for (const stretch of [first, last]) assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, stretch, 0)), [500, 100, 200]);
	assert.deepEqual(keyframes, before);
});

// 【ストレッチで0未満・端点の追い越し・全キーの重なりを防ぐ】
// 中間キー・単一キー・幅がないキー群では通常移動に戻せるようストレッチを開始しない。
// 端点の追い越しを制限して、再度ストレッチできる幅とキーの順序を残す。
test('bounds stretching and rejects interior or degenerate endpoints', () => {
	const keyframes = [{ id: 'a', x: 100 }, { id: 'b', x: 200 }, { id: 'c', x: 500 }];
	const first = createKeyframeStretch(keyframes, 'a');
	const last = createKeyframeStretch(keyframes, 'c');
	assert.equal(stretchKeyframeX(100, first, -1000), 0);
	assert.equal(stretchKeyframeX(100, first, 1000), 499);
	assert.equal(stretchKeyframeX(500, last, -1000), 101);
	assert.equal(createKeyframeStretch(keyframes, 'b'), null);
	assert.equal(createKeyframeStretch(keyframes, 'missing'), null);
	assert.equal(createKeyframeStretch([], 'a'), null);
	assert.equal(createKeyframeStretch(keyframes.slice(0, 1), 'a'), null);
	assert.equal(createKeyframeStretch([{ id: 'a', x: 10 }, { id: 'b', x: 10 }], 'a'), null);
	const small = createKeyframeStretch([{ id: 'a', x: 0 }, { id: 'b', x: 0.5 }], 'b');
	assert.equal(stretchKeyframeX(0.5, small, -1), 0.5);
});

// 【ストレッチ端点をスナップさせ、中間キーも同じ比率で更新する】
// ローカル時刻とグローバル時刻の差を考慮し、固定端を越えるスナップ候補を無視する。
test('snaps the stretched endpoint within its bounds and scales intermediate keys', () => {
	const keyframes = [{ id: 'first', x: 100 }, { id: 'middle', x: 200 }, { id: 'last', x: 500 }];
	const stretch = createKeyframeStretch(keyframes, 'last');
	const points = [{ time: 1500, ...stretch }];
	const result = constrainTimelineMove(198, points, [1100, 1700], 1);
	assert.equal(result.delta, 200);
	assert.deepEqual(keyframes.map(point => stretchKeyframeX(point.x, stretch, result.delta)), [100, 250, 700]);
	assert.deepEqual(constrainTimelineMove(-399, points, [1100], 1), { delta: -399, snappingTime: null });
});

const key = (layerId, keyframeId, target = 'audio', paramId = 'volume') => ({ layerId, target, paramPath: [paramId], keyframeId });

// 【同じレイヤーの選択済みキーだけをストレッチ対象にする】
// 一部だけ選んだレーンでは未選択キーを追加せず、別レイヤーも巻き込まない。
// キーIDやパラメータIDが同じでも、レイヤー・パラメータの所属先を区別する。
test('preserves partial selections across lanes when choosing stretch targets', () => {
	const dragged = key('video', '0', 'compositing', 'opacity');
	const lane = [dragged, key('video', '1', 'compositing', 'opacity')];
	const selectedLane = [key('video', '0'), key('video', '1')];
	const unselected = [key('video', '0', 'module', 'volume'), key('video', '0', 'compositing', 'rotation')];
	const otherLayer = [key('audio', '0'), key('audio', '1')];
	const all = [...lane, ...selectedLane, ...unselected, ...otherLayer];
	const selection = { kind: 'keyframes', keyframes: [dragged, selectedLane[1], otherLayer[0]] };
	assert.deepEqual(getTimelineStretchSelection(all, selection, dragged), [dragged, selectedLane[1]]);
	assert.deepEqual(selection.keyframes, [dragged, selectedLane[1], otherLayer[0]]);
	assert.deepEqual(getTimelineStretchSelection(all, { kind: 'keyframes', keyframes: [...lane, ...selectedLane] }, dragged), [...lane, ...selectedLane]);
	assert.deepEqual(getTimelineStretchSelection(all, { kind: 'layers', ids: ['video', 'audio'] }, dragged), lane);
	assert.deepEqual(getTimelineStretchSelection(all, { kind: 'keyframes', keyframes: [otherLayer[0]] }, dragged), lane);
});

// 【未選択キーとの境界で全体のストレッチを止める】
// 選択範囲外・範囲内に未選択キーがある場合も、100msまたは開始時の短い間隔を残す。
// 共通固定端の左右で移動方向が逆になる場合の制約も確認する。
test('constrains partial stretching against unselected neighbors on either side of the anchor', () => {
	const lane = [{ id: 'a', x: 100 }, { id: 'b', x: 150 }, { id: 'c', x: 200 }, { id: 'd', x: 800 }];
	const selected = new Set(['a', 'c']);
	const affected = lane.filter(point => selected.has(point.id)).map(point => ({ ...point, ...keyframeMoveBounds(lane, selected, point.id) }));
	const first = createKeyframeStretch(affected, 'a', affected);
	assert.equal(first.maxDelta, 0);
	assert.equal(stretchKeyframeX(100, first, 100), 100);
	const last = createKeyframeStretch(affected, 'c', [...affected, { x: 50, minDelta: -25, maxDelta: 25 }]);
	assert.equal(last.minDelta, 0);
	assert.equal(last.maxDelta, 50);
	assert.equal(stretchKeyframeX(200, last, 100), 250);
	assert.equal(stretchKeyframeX(50, last, 100), 25);
});

// 【別レーンの範囲外キーも含めて伸縮の下限・上限を求める】
// ドラッグ元より早いキーが存在すると、端点が0以上でも別レーンだけ負の時刻になり得る。
// 個別の丸めで相対関係を壊さず、共通倍率を制限して先頭・末尾のどちらの操作でも防ぐ。
test('bounds both stretch directions against keys outside the dragged lane', () => {
	const lane = [{ id: 'first', x: 100 }, { id: 'last', x: 500 }];
	const affected = [...lane, { x: 50 }, { x: 800 }];
	const first = createKeyframeStretch(lane, 'first', affected);
	const last = createKeyframeStretch(lane, 'last', affected);
	assert.ok(Math.abs(first.minDelta + 400 / 9) < 1e-8);
	assert.equal(last.maxDelta, 400);
	assert.deepEqual(affected.map(point => stretchKeyframeX(point.x, last, 1000)), [100, 900, 0, 1500]);
	for (const point of affected) {
		assert.ok(stretchKeyframeX(point.x, first, -1000) >= 0);
		assert.equal(stretchKeyframeX(point.x, first, 0), point.x);
	}
	const atZero = createKeyframeStretch(lane, 'last', [...affected, { x: 0 }]);
	assert.equal(atZero.maxDelta, 0);
	assert.deepEqual(constrainTimelineMove(401, [{ time: 500, ...last }], [902], 1), { delta: 400, snappingTime: null });
});

const clip = layerId => ({ layerId, clipId: 'clip' });
const empty = { kind: 'clips', clips: [] };
const geometry = {
	clips: [{ selection: clip('long'), rect: { left: -1000, top: 0, right: 1000, bottom: 20 } }, { selection: clip('short'), rect: { left: 30, top: 50, right: 60, bottom: 70 } }],
	keyframes: [{ selection: key('long', 'a'), x: 10, y: 30 }, { selection: key('short', 'b'), x: 50, y: 80 }],
};

// 【Shapeを含む全種別のレーンを実測し、DOMのない中間行と一緒に選択する】
// 画面外の各キーのDOMに依存せず、IDパスとレーンの中心を対応付ける。
// Shapeなどの種類が境界行でだけ選択できなくなる退行も検出する。
test('measures all lane kinds and selects unmounted intermediate layers', () => {
	const targets = ['audio', 'module', 'compositing', 'effect', 'shape'];
	const paramPath = ['items', 'element-id', 'value'];
	const element = {
		getBoundingClientRect: () => ({ top: 100 }),
		querySelector: () => ({ getBoundingClientRect: () => ({ top: 100, bottom: 124 }) }),
		querySelectorAll: () => targets.map((target, index) => ({
			dataset: { parameterTarget: target, paramPath: JSON.stringify(paramPath) },
			getBoundingClientRect: () => ({ top: 144 + index * 20, bottom: 164 + index * 20 }),
		})),
	};
	const measured = measureTimelineLayerSelection(element);
	assert.deepEqual(measured.clipLane, { top: 0, bottom: 24 });
	assert.deepEqual(targets.map(target => measured.keyframeLanes.get(timelineLaneKey(target, paramPath))), [54, 74, 94, 114, 134]);
	const layers = ['first', 'unmounted', 'last'].map(id => ({ id, clips: [], lanes: targets.map(target => ({ target, paramPath, keyframes: [{ id: 'point', x: 50 }] })) }));
	const layouts = new Map([['first', measured], ['last', measured]]);
	const candidates = collectTimelineMarqueeCandidates(layers, { layerId: 'first', offsetY: 130 }, { layerId: 'last', offsetY: 55 }, layouts,
		{ left: 0, right: 100, position: 0, range: 100, width: 100 });
	assert.deepEqual(candidates.keyframes.map(point => [point.layerId, point.target]), [['first', 'shape'], ...targets.map(target => ['unmounted', target]), ['last', 'audio']]);
	assert.ok(candidates.keyframes.every(point => point.paramPath === paramPath));
	assert.deepEqual(mergeTimelineRangeSelection(candidates.clips, candidates.keyframes, empty, false), { kind: 'keyframes', keyframes: candidates.keyframes });
});

// 【一部だけ重なる長いクリップも選び、キーよりクリップを優先する】
// クリップ全体を囲めないズーム倍率でも選択でき、上下左右どちら向きのドラッグでも結果が揃う必要がある。
test('selects intersecting clips before keyframes in every drag direction', () => {
	for (const [x1, y1, x2, y2] of [[0, 10, 55, 85], [55, 85, 0, 10], [0, 85, 55, 10], [55, 10, 0, 85]]) {
		assert.deepEqual(selectTimelineRange(selectionRect(x1, y1, x2, y2), geometry, empty, false), { kind: 'clips', clips: ['long', 'short'].map(clip) });
	}
});

// 【キーは中心点で判定し、通常選択では以前の選択を置き換える】
// ノブの大きさやCSSの変更で選択判定が変わらないよう、境界上の中心を含み、外れた中心を除く。
test('selects keyframe centers inclusively and replaces previous selection', () => {
	assert.deepEqual(selectTimelineRange(selectionRect(10, 30, 20, 40), geometry, { kind: 'clips', clips: ['old'].map(clip) }, false), { kind: 'keyframes', keyframes: [key('long', 'a')] });
	assert.deepEqual(selectTimelineRange(selectionRect(11, 30, 20, 40), geometry, { kind: 'keyframes', keyframes: [key('long', 'a')] }, false), { kind: 'keyframes', keyframes: [] });
});

// 【Shiftで種類を維持し、同じ対象を重複追加しない】
// キーを追加する途中でクリップを囲んでも既存のキーを失わず、クリップ選択中はキーだけを囲んでも種類を変えない。
test('adds only the existing selection kind and deduplicates identities', () => {
	const all = selectionRect(-10, -10, 100, 100);
	assert.deepEqual(selectTimelineRange(all, geometry, { kind: 'keyframes', keyframes: [key('long', 'a')] }, true), { kind: 'keyframes', keyframes: [key('long', 'a'), key('short', 'b')] });
	assert.deepEqual(selectTimelineRange(all, geometry, { kind: 'clips', clips: ['long'].map(clip) }, true), { kind: 'clips', clips: ['long', 'short'].map(clip) });
	assert.deepEqual(selectTimelineRange(selectionRect(0, 25, 20, 35), geometry, { kind: 'clips', clips: ['short'].map(clip) }, true), { kind: 'clips', clips: ['short'].map(clip) });
	assert.deepEqual(selectTimelineRange(all, geometry, empty, true), { kind: 'clips', clips: ['long', 'short'].map(clip) });
	assert.notEqual(keyframeSelectionKey(key('long', 'a')), keyframeSelectionKey(key('short', 'a')));
});

// 【囲む範囲を縮めたときは途中で選択した対象を残さない】
// 各更新をドラッグ開始時の選択へ適用することで、追加選択でも今回のドラッグで一度触れただけの対象は解除できる。
test('shrinks the marquee against its initial selection', () => {
	const previous = { kind: 'clips', clips: ['old'].map(clip) };
	assert.deepEqual(selectTimelineRange(selectionRect(0, 0, 100, 100), geometry, previous, true).clips, ['old', 'long', 'short'].map(clip));
	assert.deepEqual(selectTimelineRange(selectionRect(0, 0, 20, 10), geometry, previous, true).clips, ['old', 'long'].map(clip));
	assert.deepEqual(previous.clips, ['old'].map(clip));
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
		const clips = content.map(({ id, y }) => ({ selection: clip(id), rect: { left: 130, right: 150, top: viewport.top + y - scrollTop - 10, bottom: viewport.top + y - scrollTop + 10 } }));
		const keyframes = content.map(({ id, y }) => ({ selection: key(id, 'point'), x: 140, y: viewport.top + y - scrollTop }));
		assert.deepEqual(selectTimelineRange(rect, { clips, keyframes }, empty, false), { kind: 'clips', clips: expectedIds.map(clip) });
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
// 連続する複数キーだけでなく、間に未選択キーがある場合も100msを残して順序を保つ。
test('constrains keyframes against unselected neighbors and local time zero', () => {
	const points = [0, 100, 200, 300].map(x => ({ id: String(x), x }));
	const selected = new Set(['100', '200']);
	const bounds = ['100', '200'].map(id => keyframeMoveBounds(points, selected, id));
	assert.deepEqual(bounds, [{ minDelta: 0, maxDelta: 100 }, { minDelta: -100, maxDelta: 0 }]);
	assert.equal(constrainTimelineMove(250, bounds.map((bound, index) => ({ ...bound, time: 1000 + index * 100 })), [], 1).delta, 0);
	assert.deepEqual(keyframeMoveBounds(points, new Set(['0', '200']), '0'), { minDelta: 0, maxDelta: 0 });
	assert.deepEqual(keyframeMoveBounds(points, new Set(['0', '200']), '200'), { minDelta: 0, maxDelta: 0 });
	assert.deepEqual(keyframeMoveBounds(points, new Set(points.map(point => point.id)), '100'), { minDelta: -100, maxDelta: Infinity });
});

// 【ローカル目盛りは表示範囲と内容の時間原点から生成する】
// グローバル目盛りのラベルだけを引き算するとローカル0が目盛りにならないため、ローカル時間軸で刻む。
// パン・クリップ移動・ズーム後も基準を保ち、左トリム後の内容時刻を0に戻さないことを確認する。
test('generates local ticks around the content origin across panning and zooming', () => {
	assert.deepEqual(getTimelineLocalTicks(1234, 0, 4000, 5), [-2000, -1000, 0, 1000, 2000, 3000]);
	assert.deepEqual(getTimelineLocalTicks(2334, 1100, 4000, 5), [-2000, -1000, 0, 1000, 2000, 3000]);
	assert.deepEqual(getTimelineLocalTicks(1234, 1234, 2000, 5), [0, 500, 1000, 1500, 2000]);
	const trimmedClip = { startMs: 500, durationMs: 1000, contentOffsetMs: 700 };
	const ticks = getTimelineLocalTicks(trimmedClip.startMs - trimmedClip.contentOffsetMs, 0, 1000, 6);
	assert.deepEqual(ticks, [200, 400, 600, 800, 1000, 1200]);
	assert.equal(formatTimelineTimecode(trimmedClip.contentOffsetMs), '0:00.7');
	assert.deepEqual(getTimelineLocalTicks(0, 0, 0, 15), []);
});

// 【クリップごとに内容時刻で刻み、表示区間の終端には目盛りを置かない】
// トリム済みクリップの内容時刻と、隣接する別クリップの0を区別する。
// ラベルとScene上の吸着位置を一組で返すことで、両者の原点が混ざる退行を防ぐ。
test('returns clip content labels and scene positions within half-open clip bounds', () => {
	assert.deepEqual(getTimelineClipTicks({ startMs: 1250, durationMs: 1500, contentOffsetMs: 750 }, 0, 4000, 5), {
		major: [{ contentTimeMs: 1000, sceneTimeMs: 1500 }, { contentTimeMs: 2000, sceneTimeMs: 2500 }],
		minor: [{ contentTimeMs: 1500, sceneTimeMs: 2000 }],
	});
	assert.deepEqual(getTimelineClipTicks({ startMs: 2750, durationMs: 1000, contentOffsetMs: 0 }, 0, 4000, 5), {
		major: [{ contentTimeMs: 0, sceneTimeMs: 2750 }],
		minor: [{ contentTimeMs: 500, sceneTimeMs: 3250 }],
	});
});

// 【短いクリップの補助目盛りを残し、画面外には候補を作らない】
// 主目盛りが1本も入らない表示区間でも補助目盛りへ吸着できるよう、範囲を絞る順序を守る。
// パン後は見えている目盛りだけを返し、ズームの倍率で目盛り間隔を決める。
test('preserves minor ticks in short clips and clips ticks to the viewport', () => {
	const clip = { startMs: 1250, durationMs: 200, contentOffsetMs: 450 };
	assert.deepEqual(getTimelineClipTicks(clip, 0, 4000, 5), {
		major: [], minor: [{ contentTimeMs: 500, sceneTimeMs: 1300 }],
	});
	assert.deepEqual(getTimelineClipTicks(clip, 1350, 4000, 5), { major: [], minor: [] });
	assert.deepEqual(getTimelineClipTicks(clip, 0, 1000, 5), { major: [], minor: [] });
	assert.deepEqual(getTimelineClipTicks(clip, 1250, 200, 5), {
		major: [450, 500, 550, 600].map(contentTimeMs => ({ contentTimeMs, sceneTimeMs: contentTimeMs + 800 })),
		minor: [475, 525, 575, 625].map(contentTimeMs => ({ contentTimeMs, sceneTimeMs: contentTimeMs + 800 })),
	});
	assert.deepEqual(getTimelineClipTicks(clip, 0, 0, 15), { major: [], minor: [] });
});

// 【キーは各クリップの目盛りへScene時刻のまま吸着し、空白には吸着しない】
// 同じレイヤー内でもクリップごとに原点が違う。表示に使った目盛りのScene時刻を候補にして、
// クリップ間の空白へ仮想的なローカル目盛りを延長しないことを確認する。
test('snaps scene-time keyframes to each clip ruler without extending ticks into gaps', () => {
	const clips = [
		{ startMs: 250, durationMs: 1000, contentOffsetMs: 0 },
		{ startMs: 2250, durationMs: 1000, contentOffsetMs: 500 },
	];
	const localTimes = clips.flatMap(clip => {
		const ticks = getTimelineClipTicks(clip, 0, 4000, 5);
		return [...ticks.major, ...ticks.minor].map(tick => tick.sceneTimeMs);
	});
	const candidates = getTimelineSnapCandidates({ enabled: true, globalTicks: false, localTicks: true }, [], [], localTimes);
	for (const time of [747, 2747]) {
		const points = [{ time, minDelta: -time, maxDelta: Infinity, snapTimes: candidates }];
		assert.deepEqual(constrainTimelineMove(2, points, [], 1), { delta: 3, snappingTime: time + 3 });
		assert.deepEqual(getTimelineSnappingTimes(points, [], 3), [time + 3]);
	}
	const gapPoints = [{ time: 1747, minDelta: -1747, maxDelta: Infinity, snapTimes: candidates }];
	assert.deepEqual(constrainTimelineMove(2, gapPoints, [], 1), { delta: 2, snappingTime: null });
	assert.deepEqual(getTimelineSnappingTimes(gapPoints, [], 3), []);
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
	const manager = new ProjectContext().stateManager;
	const binding = () => ({ inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [100, 200, 800].map((x, index) => ({ id: String(index), x, value: index, interpolation: { type: 'linear' } })) } });
	manager.state.timelineScenes.value = [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [
		{ id: 'audio', layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 200, durationMs: 1000, assetId: 'sound' }], audioParamValues: { volume: binding() }, automationGraphs: [] },
		{ id: 'video', layerType: 'video', name: 'Layer', clips: [{ id: 'clip', startMs: 1050, contentOffsetMs: 50, durationMs: 2000, assetId: 'movie', audioEnabled: true }],
			compositingParamValues: { opacity: binding() }, audioParamValues: { volume: binding() }, automationGraphs: [] },
	] }];
	return manager;
}
const layers = manager => manager.state.timelineScenes.value[0].layers;
const snapshot = manager => JSON.parse(JSON.stringify(layers(manager)));

// 【複数レーンを共通の固定端で伸縮し、1回のUndoで復元する】
// 全キーを選択した音声レーンとドラッグ元の合成レーンをまとめて操作する。
// 別レイヤーは変更せず、値・補間を維持して全体の伸縮と履歴の統合を確認する。
test('stretches selected lanes together in one undoable command', () => {
	const manager = fixture();
	layers(manager)[1].audioParamValues.volume.keyframesTimeline.keyframes.forEach((point, index) => { point.x = [50, 400, 1000][index]; });
	const before = snapshot(manager);
	const dragged = key('video', '2', 'compositing', 'opacity');
	const all = before.flatMap(layer => (layer.layerType === 'audio'
		? [['audio', 'volume', layer.audioParamValues.volume]]
		: [['compositing', 'opacity', layer.compositingParamValues.opacity], ['audio', 'volume', layer.audioParamValues.volume]])
		.flatMap(([target, paramId, binding]) => binding.keyframesTimeline.keyframes.map(point => ({ ...key(layer.id, point.id, target, paramId), x: point.x }))));
	const selection = getTimelineStretchSelection(all, { kind: 'keyframes', keyframes: [...all.filter(point => point.layerId === 'video'), key('audio', '0')] }, dragged);
	const selected = new Set(selection.map(keyframeSelectionKey));
	const positions = all.filter(point => selected.has(keyframeSelectionKey(point)));
	const lane = before[1].compositingParamValues.opacity.keyframesTimeline.keyframes;
	const stretch = createKeyframeStretch(lane, dragged.keyframeId, positions);
	for (const delta of [350, 700, 1000]) manager.commit('moveTimelineKeyframes', {
		sceneId: 'scene', positions: positions.map(point => ({ ...point, x: stretchKeyframeX(point.x, stretch, delta) })),
	}, 'stretch');
	const expected = structuredClone(before);
	expected[1].compositingParamValues.opacity.keyframesTimeline.keyframes.forEach((point, index) => { point.x = [100, 300, 1500][index]; });
	expected[1].audioParamValues.volume.keyframesTimeline.keyframes.forEach((point, index) => { point.x = [0, 700, 1900][index]; });
	assert.deepEqual(snapshot(manager), expected);
	assert.equal(manager.undoStack.value.length, 1);
	manager.undo();
	assert.deepEqual(snapshot(manager), before);
	manager.redo();
	assert.deepEqual(snapshot(manager), expected);
});

// 【複数レーンの部分選択だけを伸縮し、未選択キーと値を維持してUndoする】
// ドラッグ元では選択範囲の端を基準にし、別レーンの選択キーにも同じ倍率を適用する。
// 未選択キーに達した時点で全体を制限し、繰り返しの更新を1回で復元できることを確認する。
test('stretches only selected keys across lanes and restores them with one undo', () => {
	const manager = fixture();
	layers(manager)[1].audioParamValues.volume.keyframesTimeline.keyframes.forEach((point, index) => { point.x = [50, 400, 1000][index]; });
	const before = snapshot(manager);
	const opacity = before[1].compositingParamValues.opacity.keyframesTimeline.keyframes;
	const volume = before[1].audioParamValues.volume.keyframesTimeline.keyframes;
	const all = [...opacity.map(point => ({ ...key('video', point.id, 'compositing', 'opacity'), x: point.x })),
		...volume.map(point => ({ ...key('video', point.id), x: point.x }))];
	const selected = [key('video', '0', 'compositing', 'opacity'), key('video', '1', 'compositing', 'opacity'), key('video', '1')];
	const selection = { kind: 'keyframes', keyframes: selected };
	const targets = new Set(getTimelineStretchSelection(all, selection, selected[1]).map(keyframeSelectionKey));
	const positions = all.filter(point => targets.has(keyframeSelectionKey(point)));
	const bounds = positions.map(point => ({ x: point.x, ...keyframeMoveBounds(point.target === 'compositing' ? opacity : volume,
		new Set(positions.filter(entry => entry.target === point.target).map(entry => entry.keyframeId)), point.keyframeId) }));
	const stretch = createKeyframeStretch(opacity.filter(point => point.id !== '2'), '1', bounds);
	assert.equal(stretch.anchorX, 100);
	assert.equal(stretch.maxDelta, 500 / 3);
	for (const delta of [50, 500, 100, 200]) manager.commit('moveTimelineKeyframes', {
		sceneId: 'scene', positions: positions.map(point => ({ ...point, x: stretchKeyframeX(point.x, stretch, delta) })),
	}, 'partial-stretch');
	const expected = structuredClone(before);
	expected[1].compositingParamValues.opacity.keyframesTimeline.keyframes[1].x = 367;
	expected[1].audioParamValues.volume.keyframesTimeline.keyframes[1].x = 900;
	assert.deepEqual(snapshot(manager), expected);
	assert.deepEqual(selection.keyframes, selected);
	assert.equal(manager.undoStack.value.length, 1);
	manager.undo();
	assert.deepEqual(snapshot(manager), before);
	manager.redo();
	assert.deepEqual(snapshot(manager), expected);
});

// 【連続ストレッチを1回のUndoで復元し、他のパラメータを変更しない】
// ドラッグ中の更新を同じ履歴にまとめ、端点・中間キーの時刻だけを変更する。
// 往復操作でも累積変形せず、値・補間・別レイヤーがそのまま復元できることを確認する。
test('undoes and redoes a stretch as one command while preserving other parameters', () => {
	for (const endpoint of ['0', '2']) {
		const manager = fixture();
		const before = snapshot(manager);
		const keyframes = before[0].audioParamValues.volume.keyframesTimeline.keyframes;
		const stretch = createKeyframeStretch(keyframes, endpoint);
		for (const delta of [50, 80, 20, 70]) {
			manager.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: keyframes.map(point => ({ ...key('audio', point.id), x: stretchKeyframeX(point.x, stretch, delta) })) }, 'stretch');
		}
		const expected = structuredClone(before);
		expected[0].audioParamValues.volume.keyframesTimeline.keyframes = keyframes.map(point => ({ ...point, x: Math.round(stretchKeyframeX(point.x, stretch, 70)) }));
		assert.deepEqual(snapshot(manager), expected);
		assert.equal(manager.undoStack.value.length, 1);
		manager.undo();
		assert.deepEqual(snapshot(manager), before);
		manager.redo();
		assert.deepEqual(snapshot(manager), expected);
	}
});

// 【一括クリップ移動を1回のUndoで戻し、同じ結果へRedoする】
// ドラッグの更新回数にかかわらず履歴を1件にまとめ、区間内のキーだけを追従させる。
// 素材のトリム・キーの値と補間は変更しない。
test('undoes and redoes a multi-clip drag as one history entry', () => {
	const manager = fixture();
	const before = snapshot(manager);
	for (const deltaMs of [20, 40, 40]) manager.commit('moveTimelineClips', { sceneId: 'scene', clips: before.map(layer => ({ layerId: layer.id, clipId: 'clip' })), deltaMs }, 'drag');
	assert.equal(manager.undoStack.value.length, 1);
	const after = before.map(layer => ({ ...layer, clips: layer.clips.map(clip => ({ ...clip, startMs: clip.startMs + 100 })) }));
	after[0].audioParamValues = structuredClone(before[0].audioParamValues);
	after[0].audioParamValues.volume.keyframesTimeline.keyframes.forEach(point => { point.x += 100; });
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
	assert.deepEqual(after[0].audioParamValues.volume.keyframesTimeline.keyframes.map(point => point.x), [150, 250, 800]);
	assert.deepEqual(after[1].compositingParamValues.opacity.keyframesTimeline.keyframes.map(point => point.x), [150, 200, 800]);
	assert.deepEqual(after[1].audioParamValues.volume.keyframesTimeline.keyframes.map(point => point.x), [100, 250, 800]);
	assert.deepEqual(after.map(layer => layer.clips), before.map(layer => layer.clips));
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
	assert.throws(() => manager.commit('moveTimelineClips', { sceneId: 'scene', clips: [{ layerId: 'audio', clipId: 'clip' }, { layerId: 'video', clipId: 'missing' }], deltaMs: 100 }), /Timeline clip not found/);
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
		element.ownerDocument = { defaultView: globalThis.window };
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

// 【背景クリックでは親要素にCaptureせず、ドラッグ開始後だけ捕捉する】
// pointerdown直後に親へCaptureすると、子レーンのclick/dblclickも親へ送られ追加操作が届かない。
// 微小な手ぶれでは捕捉せず、実際のドラッグは一覧要素で追跡し、終了前後のリスナーも解除する。
test('defers ancestor pointer capture until dragging so lane clicks keep their target', () => {
	for (const drag of [false, true]) {
		for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur', 'pagehide', 'dispose']) {
			const view = new EventTarget();
			const element = new EventTarget();
			element.ownerDocument = { defaultView: view };
			let captured = false;
			let captureCount = 0;
			element.setPointerCapture = () => { captured = true; captureCount++; };
			element.hasPointerCapture = () => captured;
			element.releasePointerCapture = () => { captured = false; };
			const moves = [];
			let ended = 0;
			const stop = listenPointerDrag({ pointerId: 1, clientX: 100, clientY: 200 },
				event => moves.push([event.clientX, event.clientY]), () => ended++, element, { captureAfterDistance: 3 });
			const dispatch = (target, type, pointerId, clientX, clientY) => target.dispatchEvent(Object.assign(new Event(type), { pointerId, clientX, clientY }));
			assert.equal(captured, false);
			dispatch(view, 'pointermove', 2, 150, 250);
			dispatch(view, 'pointerup', 2, 150, 250);
			assert.equal(captured, false);
			assert.equal(ended, 0);
			dispatch(view, 'pointermove', 1, 101, 202);
			assert.equal(captured, false);
			if (drag) {
				dispatch(view, 'pointermove', 1, 100, 203);
				assert.equal(captured, true);
				// タッチ開始時の暗黙のCaptureが子から親へ移ると、子の喪失通知が親へバブルする。
				const childLostCapture = Object.assign(new Event('lostpointercapture'), { pointerId: 1 });
				Object.defineProperty(childLostCapture, 'target', { value: new EventTarget() });
				element.dispatchEvent(childLostCapture);
				assert.equal(ended, 0);
				assert.equal(captured, true);
				dispatch(view, 'pointermove', 1, 110, 210);
				assert.equal(captureCount, 1);
			}
			if (ending === 'dispose') stop();
			else dispatch(ending === 'lostpointercapture' ? element : view, ending, 1, 101, 202);
			const moveCount = moves.length;
			dispatch(view, 'pointermove', 1, 200, 300);
			stop();
			assert.equal(moves.length, moveCount);
			assert.equal(ended, 1);
			assert.equal(captured, false);
			assert.equal(captureCount, drag ? 1 : 0);
			const expectedMoves = drag ? [[101, 202], [100, 203], [110, 210]] : [[101, 202]];
			if (ending === 'pointerup') expectedMoves.push([101, 202]);
			assert.deepEqual(moves, expectedMoves);
		}
	}
});

// 【複数レイヤーのクリップを最も近い衝突位置で一括停止する】
// 一つでも移動不能なら共通差分を制限する。最終位置に空きがあっても隣を飛び越さず、
// 最後のクリップを削除した場合もレイヤー設定とキーを復元可能な形で残す。
test('clamps all selected clips together and retains empty layers with their keys', () => {
	const manager = fixture();
	const layers = manager.state.timelineScenes.value[0].layers;
	layers[0].clips.push({ ...layers[0].clips[0], id: 'next', startMs: 1200 });
	const before = snapshot(manager);
	const targets = before.map(layer => ({ layerId: layer.id, clipId: 'clip' }));
	manager.commit('moveTimelineClips', { sceneId: 'scene', clips: targets, deltaMs: 10000 });
	assert.deepEqual(layers.map(layer => layer.clips[0].startMs), [200, 1150]);
	assert.equal(layers[0].clips[1].startMs, 1200);
	manager.undo();
	assert.deepEqual(snapshot(manager), before);
	manager.commit('removeTimelineClips', { sceneId: 'scene', clips: [...targets, { layerId: 'audio', clipId: 'next' }] });
	assert.deepEqual(snapshot(manager), before.map(layer => ({ ...layer, clips: [] })));
	manager.undo();
	assert.deepEqual(snapshot(manager), before);
});

// 【接触した複数クリップを開始位置から共通の整数差分で移動する】
// 小数のpointermoveを繰り返し加算せず、最後の累積差分だけで配置が決まることを確認する。
// 別レイヤーにも同量を適用し、素材位置・長さ・キーを保ったままUndo/Redoできる必要がある。
test('moves touching clips from drag snapshots with one rounded delta and stable undo', () => {
	const manager = fixture();
	const [audio, video] = layers(manager);
	Object.assign(audio.clips[0], { startMs: 1000, durationMs: 1000, contentOffsetMs: 0.25 });
	audio.clips.push({ ...audio.clips[0], id: 'next', startMs: 2000, contentOffsetMs: 11.75 });
	video.clips[0].contentOffsetMs = 50.25;
	const before = snapshot(manager);
	const targets = before.flatMap(layer => layer.clips.map(clip => ({ layerId: layer.id, clipId: clip.id, initialStartMs: clip.startMs })));
	for (const deltaMs of [0.4, -10.6, -1000.1]) {
		manager.commit('moveTimelineClips', { sceneId: 'scene', clips: targets, deltaMs }, 'integer-drag');
	}
	const expected = before.map(layer => ({ ...layer, clips: layer.clips.map(clip => ({ ...clip, startMs: clip.startMs - 1000 })) }));
	assert.deepEqual(snapshot(manager), expected);
	assert.equal(audio.clips[0].startMs + audio.clips[0].durationMs, audio.clips[1].startMs);
	assert.equal(manager.undoStack.value.length, 1);
	for (let index = 0; index < 2; index++) {
		manager.undo();
		assert.deepEqual(snapshot(manager), before);
		manager.redo();
		assert.deepEqual(snapshot(manager), expected);
	}
});

// 【小数のローカル目盛りへの吸着と表示線を整数msへ揃える】
// 素材オフセット由来の目盛りは小数でも、配置とキーには小数時刻を保存しない。
// 移動可能範囲も内側の整数へ制限し、素材範囲を超える丸めを防ぐ。
test('snaps edits to integer milliseconds within fractional bounds', () => {
	const points = [{ time: 100, minDelta: -100, maxDelta: 1000, snapTimes: [500.4] }];
	assert.deepEqual(constrainTimelineMove(400.2, points, [], 1), { delta: 400, snappingTime: 500 });
	assert.deepEqual(getTimelineSnappingTimes(points, [], 400), [500]);
	assert.deepEqual(constrainTimelineMove(3.6, [{ time: 100, minDelta: 0.25, maxDelta: 3.75 }], [], 1), { delta: 3, snappingTime: null });
	assert.deepEqual(constrainTimelineMove(0, [{ time: 100, minDelta: 0.25, maxDelta: 3.75 }], [], 1), { delta: 1, snappingTime: null });
});

// 【キーの数値編集も整数msへ丸めて履歴を復元する】
// ドラッグ以外からコマンドを呼んでも、タイムラインの保存値へ小数位置を混入させない。
test('rounds keyframe command positions and restores them on undo', () => {
	for (const editBinding of [false, true]) {
		const manager = fixture();
		const before = snapshot(manager);
		if (editBinding) {
			const value = structuredClone(before[0].audioParamValues.volume);
			value.keyframesTimeline.keyframes[0].x = 100.6;
			manager.commit('editTimelineLayerParam', { sceneId: 'scene', layerId: 'audio', target: 'audio', paramPath: ['volume'], edit: { kind: 'keyframesTimelineInline', value } });
			assert.equal(value.keyframesTimeline.keyframes[0].x, 100.6);
		} else {
			manager.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...key('audio', '0'), x: 100.6 }] });
		}
		assert.equal(layers(manager)[0].audioParamValues.volume.keyframesTimeline.keyframes[0].x, 101);
		manager.undo();
		assert.deepEqual(snapshot(manager), before);
		manager.redo();
		assert.equal(layers(manager)[0].audioParamValues.volume.keyframesTimeline.keyframes[0].x, 101);
	}
});
