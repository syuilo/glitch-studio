import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const result = await build({ absWorkingDir: directory, stdin: {
	contents: "export * from './src/utility/timeline-marquee.ts'; export * from './src/utility/timeline-selection.ts';",
	resolveDir: directory, loader: 'ts',
}, bundle: true, platform: 'node', format: 'cjs', write: false });
const module = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { collectTimelineMarqueeCandidates, timelineLaneKey, mergeTimelineRangeSelection } = module.exports;
const lane = { target: 'effect', paramPath: ['items', 'element-id', 'value'], keyframes: [{ id: 'a', x: 25 }, { id: 'b', x: 50 }] };
const layers = ['a', 'b', 'c', 'd', 'e'].map(id => ({
	id, clips: [{ id: 'clip', startMs: 0, durationMs: 100 }], lanes: [lane],
}));
const measured = { clipLane: { top: 0, bottom: 24 }, keyframeLanes: new Map([[timelineLaneKey(lane.target, lane.paramPath), 54]]) };
const horizontal = { left: 20, right: 30, position: 0, range: 100, width: 100 };
const start = { layerId: 'a', offsetY: 30 };
const end = { layerId: 'e', offsetY: 10 };

// 【一度も描画しない中間行も選び、上下のドラッグ方向で結果を変えない】
// 境界の片方はクリップより下、もう片方はクリップの途中とし、部分交差も検証する。
test('selects unmeasured middle rows and partial boundary rows in either direction', () => {
	const layouts = new Map([['a', measured], ['e', measured]]);
	const expected = collectTimelineMarqueeCandidates(layers, start, end, layouts, horizontal);
	assert.deepEqual(expected.clips.map(clip => clip.layerId), ['b', 'c', 'd', 'e']);
	assert.deepEqual(expected.keyframes.map(point => [point.layerId, point.keyframeId]), [['a', 'a'], ['b', 'a'], ['c', 'a'], ['d', 'a']]);
	assert.deepEqual(collectTimelineMarqueeCandidates(layers, end, start, layouts, horizontal), expected);
});

// 【開始行へドラッグを戻すと中間行の選択を解除し、Shiftの既存選択だけを保持する】
// 通過した行を蓄積する実装では範囲を縮められないため、毎回開始前の選択に適用する。
test('shrinks back into the starting row while preserving only preexisting shift selections', () => {
	const previous = { kind: 'keyframes', keyframes: [{ layerId: 'old', target: lane.target, paramPath: lane.paramPath, keyframeId: 'old' }] };
	const layouts = new Map([['a', measured], ['e', measured]]);
	const large = collectTimelineMarqueeCandidates(layers, start, end, layouts, horizontal);
	assert.equal(mergeTimelineRangeSelection(large.clips, large.keyframes, previous, true).keyframes.length, 5);
	const small = collectTimelineMarqueeCandidates(layers, start, { layerId: 'a', offsetY: 54 }, layouts, horizontal);
	assert.equal(small.clips.length, 0);
	assert.deepEqual(mergeTimelineRangeSelection(small.clips, small.keyframes, previous, true).keyframes.map(point => point.layerId), ['old', 'a']);
	const reversed = collectTimelineMarqueeCandidates(layers, { layerId: 'a', offsetY: 54 }, start, layouts, horizontal);
	assert.deepEqual(reversed, small);
});

// 【行間からの選択と一覧前後の余白を正しく判定する】
// 境界は隣の行の端からの距離として保存するため、余白だけの選択で対象を増やさない。
test('handles gaps and space before and after the list without selecting adjacent lanes', () => {
	const layouts = new Map([['a', measured], ['b', measured], ['e', measured]]);
	assert.deepEqual(collectTimelineMarqueeCandidates(layers, { layerId: 'a', offsetY: 64 }, { layerId: 'b', offsetY: -1 }, layouts, horizontal), { clips: [], keyframes: [] });
	assert.deepEqual(collectTimelineMarqueeCandidates(layers, { layerId: 'e', offsetY: 70 }, { layerId: 'e', offsetY: 100 }, layouts, horizontal), { clips: [], keyframes: [] });
	const all = collectTimelineMarqueeCandidates(layers, { layerId: 'a', offsetY: -20 }, { layerId: 'e', offsetY: 100 }, layouts, horizontal);
	assert.equal(all.clips.length, 5);
	assert.equal(all.keyframes.length, 5);
});

// 【横スクロール・倍率と描画側のキーの丸めを範囲判定にも適用する】
// 左右の非表示部分を選ばず、長いクリップの部分交差とキー中心の境界を保つ。
// 配置を丸めた後に親を小数px移動するため、移動後の座標を再度丸めない。
test('matches painted key centers and clips horizontal geometry to the viewport', () => {
	const layouts = new Map([['a', measured]]);
	const from = { layerId: 'a', offsetY: 0 };
	const to = { layerId: 'a', offsetY: 60 };
	const selection = collectTimelineMarqueeCandidates(layers, from, to, layouts, { left: 0.75, right: 0.85, position: 24.6, range: 50, width: 100 });
	assert.equal(selection.clips.length, 1);
	assert.deepEqual(selection.keyframes.map(point => point.keyframeId), ['a']);
	assert.deepEqual(collectTimelineMarqueeCandidates(layers, from, to, layouts, { ...horizontal, position: 200 }), { clips: [], keyframes: [] });
	assert.deepEqual(collectTimelineMarqueeCandidates(layers, { layerId: 'missing', offsetY: 0 }, to, layouts, horizontal), { clips: [], keyframes: [] });
});
