import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createTimelineEffectProbe } from './helpers/timeline-effect-probe.mjs';
// GPUを初期化せず、レンダラーが実際に構築する式のスコープを検証する。
globalThis.GPUQueue = class { submit() {} };
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const def = (id, value = 7, kind = 'scalar') => ({ id, nameForReference: id.toLowerCase().replaceAll('-', '_'), dataType: { kind }, ui: { label: id, control: kind === 'scalar' ? { controlType: 'number' } : {} }, defaultValue: value, canNode: false });
const clipFrame = { sceneTimeMs: 500, contentTimeMs: 250, contentEndTimeMs: 2000, clipElapsedTimeMs: 100, clipDurationMs: 1850, isExport: true };

// 【レイヤーの離散キーフレームは評価済みの引数としてNodes Effectへ渡す】
// 文字列・bool・enumをテクスチャや式へ変換せず、プレビューと書き出しで同じ切り替え時刻を使う。
// トリム後の見かけの開始時刻でキーをリセットしないよう、Scene時刻と内容時刻を分けて往復シークも確認する。
test('passes discrete layer keyframes to Nodes Effects consistently during preview export and seeking', async () => {
	const definitions = [
		{ ...def('text', ''), dataType: { kind: 'string' } },
		{ ...def('enabled', false), dataType: { kind: 'bool' } },
		{ ...def('mode', 'b'), dataType: { kind: 'enum', options: ['a', 'b'] } },
	];
	const animated = (definition, first, second) => ({
		inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: definition.dataType, isNormalized: false, keyframes: [
			{ id: 'first', x: 0, value: first, interpolation: { type: 'hold' } },
			{ id: 'second', x: 10000, value: second, interpolation: { type: 'hold' } },
		] },
	});
	const layer = { functionCurves: [], nodesEffectParamValues: {
		text: animated(definitions[0], 'Hello\n世界', ''), enabled: animated(definitions[1], true, false), mode: animated(definitions[2], 'a', 'b'),
	} };
	let resolved;
	const adapter = createTimelineEffectProbe({ paramDefs: Object.fromEntries(definitions.map(def => [def.id, def])),
		params: layer.nodesEffectParamValues, render(frame, values) { resolved = values; } });
	for (const isExport of [false, true]) {
		for (const time of [10000, 9999, 15000, 5000]) {
			await adapter.evaluate({ sceneTimeMs: time, contentTimeMs: time - 1000, clipElapsedTimeMs: time - 1000, clipDurationMs: 20000, contentEndTimeMs: 20000, timeDelta: 0, isExport }, new AbortController().signal);
			assert.deepEqual(resolved, time >= 10000 ? { text: '', enabled: false, mode: 'b' } : { text: 'Hello\n世界', enabled: true, mode: 'a' });
		}
	}
});

// 【enumの空タイムラインは現在の定義の既定値を使う】
// 未設定のキーに古い保存型の候補を補わず、定義の変更と通常のキー評価を維持する。
test('uses current enum defaults for empty timelines and evaluates stored keyframes', async () => {
	const definition = { ...def('mode', 'b'), dataType: { kind: 'enum', options: ['a', 'b'] } };
	const input = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'enum', options: ['obsolete', 'a'] }, isNormalized: false, keyframes: [] } };
	let resolved;
	let adapter;
	const evaluate = () => {
		adapter?.destroy();
		adapter = createTimelineEffectProbe({ paramDefs: { mode: definition }, params: { mode: input }, render(frame, values) { resolved = values.mode; } });
		return adapter.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	};
	await evaluate();
	assert.equal(resolved, 'b');
	definition.defaultValue = 'a';
	await evaluate();
	assert.equal(resolved, 'a');
	input.keyframesTimeline.keyframes.push({ id: 'key', x: 0, value: 'b', interpolation: { type: 'hold' } });
	await evaluate();
	assert.equal(resolved, 'b');
});


// 【準備中に指定値を変更しても同じフレームの評価結果を保持する】
// prepareとrenderの間で元の指定が変わっても、同じフレームの評価結果を使い続ける。
test('snapshots layer values once for prepare and render', async () => {
	const params = { amount: expression('TEST_SAME_NAME'), array: literal([1, 2]) };
	const observed = [];
	const probe = createTimelineEffectProbe({ params, paramDefs: { amount: def('amount'), array: def('array', [0, 0], 'vector') },
		prepare(frame, values) {
			observed.push(values);
			params.amount = expression('99');
			params.array.value[0] = 99;
		},
		render(frame, values) { observed.push(values); },
	});
	await probe.evaluate({ ...clipFrame, timeDelta: 0 }, new AbortController().signal);
	assert.deepEqual(observed, Array(2).fill({ amount: 2, array: [1, 2] }));
	probe.destroy();
});

// 【画像入力と通常値を型付きの入力として受け取る】
// 主画像の省略で下層を参照し、通常パラメータの省略でリテラル既定値を使う。
test('resolves primary images, default parameter values and export expressions', async () => {
	let observed;
	const probe = createTimelineEffectProbe({ primaryInputParameter: 'image', paramDefs: { image: { ...def('image', [0, 0, 0, 0], 'color'), canNode: true },
		gain: def('gain', 8), exported: def('exported', false, 'bool') }, params: { exported: expression('IS_EXPORT') },
		render(frame, values) { observed = values; } });
	const input = probe.texture();
	await probe.evaluate({ ...clipFrame, timeDelta: 0, getInput: async () => input }, new AbortController().signal);
	assert.equal(observed.image.texture, input.texture);
	assert.equal(observed.gain, 8);
	assert.equal(observed.exported, true);
	probe.destroy();
});

// 【同一のレイヤーと出力段階を参照する複数の入力はフレーム内で共有する】
// 次フレームでは新しい値を取り直し、段階の異なる参照は独立して評価する。
test('shares identical layer stage references within a frame', async () => {
	const requests = [];
	let observed;
	const reference = outputStage => ({ inputSource: 'anotherLayerOutput', layerId: 'source', outputStage, sampling: { fitMode: 'cover', wrapMode: 'clamp', filterMode: 'nearest' } });
	const probe = createTimelineEffectProbe({ paramDefs: Object.fromEntries(['left', 'right', 'raw'].map(id => [id, { ...def(id, [0, 0, 0, 0], 'color'), canNode: true }])),
		params: { left: reference('rendered'), right: reference('rendered'), raw: reference('source') }, render(frame, values) { observed = values; } });
	for (let i = 0; i < 2; i++) {
		const image = probe.texture();
		const raw = probe.texture();
		await probe.evaluate({ ...clipFrame, timeDelta: 0, getLayerOutput: async (id, stage) => { requests.push([id, stage]); return stage === 'source' ? raw : image; } }, new AbortController().signal);
		assert.equal(observed.left.texture, image.texture);
		assert.equal(observed.right.texture, image.texture);
		assert.equal(observed.raw.texture, raw.texture);
	}
	assert.deepEqual(requests, Array(2).fill([['source', 'rendered'], ['source', 'source']]).flat());
	probe.destroy();
});
