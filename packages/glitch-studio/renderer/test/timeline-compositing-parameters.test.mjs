import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from './helpers/load-shader-source.mjs';

const { TimelineCompositingParameters } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_renderer/timeline-compositing-parameters.ts')));
const { timelineCompositingParamDefs } = await loadShaderSource(fileURLToPath(import.meta.resolve('@gs/subsystems_timeline_shared/timeline-compositing.ts')));
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const context = { mask: null, layerMask: null, coordinateSpace: 'screen', time: 500, endTime: 2000, isExport: false };
const evaluate = (values, graphs = [], overrides = {}) => new TimelineCompositingParameters().evaluate({ ...context, ...overrides, paramValues: { ...Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)])), ...values }, automationGraphs: graphs });

// 【マスクの設定はキーや式で変更せず、評価済みスナップショットとして合成へ渡す】
// 非同期待機中に保存値が編集されても、開始済みの描画のchannelや反転だけが途中で変わらない。
test('passes static mask settings independently of animated strength', () => {
	const mask = { channel: 'luminance', inverted: true };
	const result = evaluate({ opacity: expression('TIME_MS / 1000') }, [], { mask });
	assert.deepEqual(result.mask, mask);
	assert.notEqual(result.mask, mask);
	assert.equal(result.opacity, 0.5);
	mask.inverted = false;
	assert.equal(result.mask.inverted, true);
});

// 【座標空間はBindingの定義から除外し、レイヤーの静的な選択を使用する】
// 評価時刻やエクスポートの有無で座標系が切り替わると、一覧のスイッチ表示と描画が食い違う。
// Zなどのパラメータ評価は維持しながら、両方の座標空間がそのまま合成へ渡ることを確認する。
test('keeps the layer coordinate space fixed across evaluation times', () => {
	assert.equal('coordinateSpace' in timelineCompositingParamDefs, false);
	assert.equal('placement' in timelineCompositingParamDefs, false);
	for (const coordinateSpace of ['world', 'screen']) {
		for (const time of [0, 1000]) {
			for (const isExport of [false, true]) {
				assert.equal(evaluate({}, [], { coordinateSpace, time, isExport }).coordinateSpace, coordinateSpace);
			}
		}
	}
});

// 【初期値は通常合成・不透明・contain・無変形として評価する】
// 素材の比率が画面と異なっても、種類によらず全体を収める初期状態に揃える。
test('defaults to normal compositing with an identity transform', () => {
	assert.deepEqual(evaluate({}), { transformTarget: 'image', mask: null, layerMask: null, coordinateSpace: 'screen', depth: 0, clipToFrame: false, blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0 });
});

// 合成設定にはレイヤーの変数だけを公開し、Scene時刻を明示し、モジュールの進行率や解像度は継承しない。
test('evaluates expressions and environment variables in layer context', () => {
	const result = evaluate({
		position: expression('[TEST_SAME_NAME, 0]'),
		scale: expression('[if TEST_ONLY_LAYER { 2 } else { 0 }, 0]'),
		rotation: expression('if IS_EXPORT { 0.5 } else { 0 }'),
		opacity: expression('TEST_SAME_NAME / 4'), blendMode: expression('"replace"'),
	}, [], { isExport: true });
	assert.deepEqual(result, { transformTarget: 'image', mask: null, layerMask: null, coordinateSpace: 'screen', depth: 0, clipToFrame: false, blendMode: 19, opacity: 0.5, fitMode: 'contain', position: [2, 0], origin: [0, 0], scale: [2, 0], rotation: 0.5 });
	assert.deepEqual(evaluate({ position: expression('[HEIGHT / WIDTH, 0]') }).position, [0, 0]);
	assert.deepEqual(evaluate({ position: { inputSource: 'envVariable', variable: 'PROGRESS' } }).position, [0, 0]);
});

const point = (x, y) => ({ id: `${x}`, x, y, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] });
const graph = { id: 'ramp', nameForReference: 'Ramp', isNormalized: true, points: [point(0, 0), point(1, 1)] };
for (const inputSource of ['automationGraphInline', 'automationGraphReference']) {
	// duration・Scene開始基準・wrapを含めて、位置や回転も既存グラフと同じ規約で動かす。
	test(`evaluates timing and wrapping for ${inputSource}`, () => {
		const input = {
			inputSource, automationGraph: graph, automationGraphId: graph.id,
			trimmedDurationMs: 1000, offsetMode: 'start', wrapMode: 'repeatMirrored',
		};
		const result = evaluate({ opacity: input, rotation: input }, [graph]);
		for (const value of [result.opacity, result.rotation]) assert.ok(Math.abs(value - 0.5) < 0.00001);
	});
}

// 【グラフをnameForReferenceで参照し、欠落した参照は既定値へ戻す】
// GRAPH参照は呼び出し側が渡したレイヤーのグラフを使い、他のスコープのグラフを参照しない。
test('reads graphs by nameForReference and falls back for missing graph references', () => {
	assert.ok(Math.abs(evaluate({ position: expression('[GRAPH("Ramp", 0.25, "clamp"), 0]') }, [graph]).position[0] - 0.25) < 0.00001);
	assert.equal(evaluate({ scale: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } }).scale[0], 1);
});

// 不正な型・非有限値をGPUへ流さず、負の倍率は反転、0は透明化のために保持する。
test('sanitizes invalid values while preserving flips and zero scales', () => {
	const result = evaluate({ opacity: literal(2), position: literal([Infinity, 'bad']), scale: literal([-2, 0]), rotation: literal(NaN), blendMode: literal('constructor') });
	assert.deepEqual(result, { transformTarget: 'image', mask: null, layerMask: null, coordinateSpace: 'screen', depth: 0, clipToFrame: false, blendMode: 0, opacity: 1, fitMode: 'contain', position: [0, 0], origin: [0, 0], scale: [-2, 0], rotation: 0 });
	assert.equal(evaluate({ opacity: literal(-1) }).opacity, 0);
});

// 【Fitもレイヤーの評価スコープでリテラル・式を扱う】
// 動画専用プロパティを読まず、他の合成設定と同じBindingから配置方法を決定する。
test('evaluates fit modes from literals and layer expressions', () => {
	for (const fitMode of ['contain', 'cover', 'stretch']) {
		assert.equal(evaluate({ fitMode: literal(fitMode) }).fitMode, fitMode);
	}
	const fitMode = expression('if IS_EXPORT { "cover" } else { "contain" }');
	assert.equal(evaluate({ fitMode }).fitMode, 'contain');
	assert.equal(evaluate({ fitMode }, [], { isExport: true }).fitMode, 'cover');
});

// 【適用範囲モードはScene基準の枠を使い、画像モード用のFitを上書き保存しない】
// 時刻・書き出しでモードが変わらず、画像モードへ戻したときに元のFitを再利用できることを確認する。
test('keeps the region transform static and evaluates it independently of image fit', () => {
	const values = { fitMode: literal('cover'), position: expression('[TIME_MS / 1000, 0]') };
	assert.equal('transformTarget' in timelineCompositingParamDefs, false);
	for (const isExport of [false, true]) {
		const settings = evaluate(values, [], { transformTarget: 'region', time: 1000, isExport });
		assert.equal(settings.transformTarget, 'region');
		assert.equal(settings.fitMode, 'stretch');
		assert.deepEqual(settings.position, [1, 0]);
	}
	assert.equal(evaluate(values, [], { transformTarget: 'image' }).fitMode, 'cover');
	assert.equal(values.fitMode.value, 'cover');
});

// 【Fitの欠落・式の失敗・無効な値はcontainへ戻す】
// 型の空値であるstretchへ切り替わると、式の編集途中に素材が歪んでしまう。
test('falls back to contain for missing or invalid fit modes', () => {
	assert.equal(evaluate({ fitMode: undefined }).fitMode, 'contain');
	assert.equal(evaluate({ fitMode: expression('missing_fit_variable') }).fitMode, 'contain');
	for (const value of ['invalid', 1, null, ['cover']]) {
		assert.equal(evaluate({ fitMode: literal(value) }).fitMode, 'contain');
	}
});

// 【素材の範囲外の支点と配置先もレイヤーの式で指定できる】
// originは素材の端に制限しない。positionとは独立に評価し、画面外の点を支点にした
// アニメーションを可能にする一方、非有限値や型が不正な成分はGPUへ渡さない。
test('evaluates independent origins and positions without clamping finite coordinates', () => {
	const result = evaluate({ origin: expression('[2, -3]'), position: expression('[-4, 5]') });
	assert.deepEqual(result.origin, [2, -3]);
	assert.deepEqual(result.position, [-4, 5]);
	assert.deepEqual(evaluate({ origin: literal([Infinity, -2]) }).origin, [0, -2]);
	assert.deepEqual(evaluate({ origin: literal(['bad', NaN]) }).origin, [0, 0]);
	assert.deepEqual(evaluate({ origin: { inputSource: 'automationGraphReference', automationGraphId: 'missing' } }).origin, [0, 0]);
});
