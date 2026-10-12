import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = path => loadSource(fileURLToPath(new URL('../src/' + path, import.meta.url)));
const { TimelineRenderer } = await load('timeline-renderer.ts');
const { createTransformTimelineLayer } = await load('layers/transform/transform-timeline-layer.ts');
const literal = value => ({ inputSource: 'literal', value });
const leaf = id => ({ id, layerType: 'image', isDisabled: false, forceDisableMotionBlur: false, clips: [{ id: 'clip', startMs: 100, durationMs: 1000, contentOffsetMs: 0 }] });
const transform = (id, layers, position = [0, 0], z = 0) => ({ id, layerType: 'transform', isDisabled: false, forceDisableMotionBlur: false, automationGraphs: [],
	transformParamValues: { position: literal(position), z: literal(z) }, layers });

function fixture(layers) {
	const calls = [];
	const destroyed = [];
	const created = [];
	const find = (entries, id) => {
		for (const entry of entries) {
			if (entry.id === id) return entry;
			const nested = entry.layers && find(entry.layers, id);
			if (nested) return nested;
		}
	};
	const createLayer = entry => {
		created.push(entry.id);
		if (entry.layerType === 'transform') return createTransformTimelineLayer(() => find(layers, entry.id), { fallbackOutput: [], createLayer });
		return {
			async evaluate(context) {
				calls.push({ id: entry.id, ...context });
				return { output: [...context.input, entry.id], gpuTime: 2 };
			},
			destroy() { destroyed.push(entry.id); },
		};
	};
	const renderer = new TimelineRenderer({ fallbackOutput: [], createLayer });
	return { renderer, calls, created, destroyed, render: (time, reference) => renderer.evaluateAt(time, layers, 10, false, undefined, reference) };
}

// 【Transformの子は外側の背景へ直接重なり、追加の合成処理を行わない】
// 子を透明背景から評価すると下層入力が失われ、最後に再合成するとblendを二重適用する。
// 入れ子でも通常の順序で1回ずつ子だけを評価し、外側の上層へその結果を渡す。
test('passes the outside background through nested transforms in timeline order', async () => {
	const layers = [leaf('top'), transform('outer', [leaf('upper'), transform('inner', [leaf('lower')], [0.2, 0.1], 0.3)], [0.5, -0.1], 0.4), leaf('background')];
	const f = fixture(layers);
	try {
		const result = await f.render(500);
		assert.deepEqual(result.output, ['background', 'lower', 'upper', 'top']);
		assert.equal(result.gpuTime, 8);
		const lower = f.calls.find(call => call.id === 'lower');
		assert.deepEqual(lower.input, ['background']);
		assert.deepEqual(lower.renderSpace.parent, [1, 0, 0, 1, 0.7, 0]);
		assert.equal(lower.renderSpace.depth, 0.7);
		assert.deepEqual(f.calls.find(call => call.id === 'top').input, result.output.slice(0, -1));
		assert.equal(f.calls.find(call => call.id === 'top').renderSpace, undefined);
	} finally { f.renderer.clear(); }
});

// 【親の設定変更では子の履歴を維持し、無効化したときだけ子の資源を解放する】
// 毎フレームの揺れを理由にEffectや動画のインスタンスを作り直してはいけない。
test('keeps children alive across transform edits and skips empty or disabled subtrees', async () => {
	const parent = transform('parent', [leaf('child')]);
	const f = fixture([parent, leaf('background')]);
	try {
		await f.render(500);
		parent.transformParamValues.position = literal([1, 2]);
		await f.render(600);
		assert.deepEqual(f.created, ['background', 'parent', 'child']);
		assert.deepEqual(f.calls.at(-1).renderSpace.parent.slice(4), [1, 2]);
		parent.isDisabled = true;
		assert.deepEqual((await f.render(700)).output, ['background']);
		assert.deepEqual(f.destroyed, ['child']);
		parent.isDisabled = false;
		parent.layers = [];
		assert.deepEqual((await f.render(800)).output, ['background']);
		assert.equal((await f.render(1200)).hasOutput, false);
	} finally { f.renderer.clear(); }
});

// 【子だけのブラー無効では親の移動を残し、親を固定すると子の時計も固定する】
// 描画に渡す座標系を子の基準時刻で再評価してしまうと、カメラの親子運動と不一致になる。
test('inherits frozen clocks without freezing motion from higher ancestors', async () => {
	const child = { ...leaf('child'), forceDisableMotionBlur: true };
	const inner = transform('inner', [child]);
	const outer = transform('outer', [inner]);
	for (const parent of [inner, outer]) parent.transformParamValues.position = { inputSource: 'expression', expression: '[TIME, 0]' };
	const f = fixture([outer]);
	try {
		await f.render(500, { timeMs: 400, timeDelta: 16 });
		assert.equal(f.calls.at(-1).sceneTimeMs, 400);
		assert.equal(f.calls.at(-1).renderSpace.parent[4], 1);
		inner.forceDisableMotionBlur = true;
		await f.render(500, { timeMs: 400, timeDelta: 16 });
		assert.equal(f.calls.at(-1).renderSpace.parent[4], 0.9);
		outer.forceDisableMotionBlur = true;
		await f.render(500, { timeMs: 400, timeDelta: 16 });
		assert.equal(f.calls.at(-1).renderSpace.parent[4], 0.8);
		assert.equal(f.calls.at(-1).timeDelta, 16);
		assert.equal((await f.render(101, { timeMs: 99, timeDelta: 16 })).hasOutput, false);
	} finally { f.renderer.clear(); }
});
