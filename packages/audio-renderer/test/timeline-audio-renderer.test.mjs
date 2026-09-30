import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from '../../renderer/test/helpers/load-shader-source.mjs';

const { TimelineAudioRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-audio-renderer.ts', import.meta.url)));
const layer = (changes = {}) => ({ id: 'audio', layerType: 'audio', assetId: 'asset', positionMs: 80, trimmedDurationMs: 100, trimStartMs: 20, paramValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [], ...changes });
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(0.5)];

// 【素材の配置基準を固定した左トリムは、再生開始と読み出し位置を同じ量だけ進める】
// positionMsを動かさずにオフセットを増やしても、トリム前の区間を再生せず右端を維持する。
test('trims audio relative to a fixed source origin', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => 200);
	const output = await renderer.render([layer({ positionMs: 100, trimStartMs: 40, trimmedDurationMs: 60 })], 100, 110, 1000);
	assert.deepEqual(calls, [['asset', 0.04, 60, 1000]]);
	assert.deepEqual([...output[0].slice(0, 40)], Array(40).fill(0));
	assert.deepEqual([...output[0].slice(40, 100)], Array(60).fill(1));
	assert.deepEqual([...output[0].slice(100)], Array(10).fill(0));
});

// 【レイヤーの期間と素材オフセットを独立して扱う】
// 途中シークやトリミングで素材の先頭を再生せず、半開区間の外は無音にする。
test('mixes overlapping layers with source offsets and exclusive ends', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => 200);
	const output = await renderer.render([layer(), layer({ id: 'second' })], 90, 120, 1000);
	assert.deepEqual(calls[0], ['asset', 0.02, 100, 1000]);
	assert.deepEqual([...output[0].slice(0, 10)], Array(10).fill(0));
	assert.deepEqual([...output[0].slice(10, 110)], Array(100).fill(2));
	assert.deepEqual([...output[1].slice(10, 110)], Array(100).fill(1));
	assert.deepEqual([...output[0].slice(110)], Array(10).fill(0));
	await renderer.render([layer()], 150, 10, 1000);
	assert.equal(calls[2][1], 0.07);
});

// 【音量の式はFPSやチャンク分割に依存しない】
// プレビューの先読み量と将来の書き出しの処理単位が異なっても同じ音量になる。
test('evaluates local-time expressions consistently across chunk boundaries', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const layers = [layer({ paramValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / END_TIME_MS' } } })];
	const whole = await renderer.render(layers, 100, 100, 1000);
	const first = await renderer.render(layers, 100, 37, 1000);
	const second = await renderer.render(layers, 137, 63, 1000);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.equal(whole[0][50], Math.fround(70 / 200));
});

// 【音声の両端をトリムしても内容時刻と元ファイル基準の進捗を変えない】
// 表示区間の長さをEND_TIMEへ使うと、残した同じ音声部分の音量まで変化してしまう。
test('keeps expression timing unchanged when either audio edge is trimmed', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const original = layer({ positionMs: 0, trimStartMs: 0, trimmedDurationMs: 200,
		paramValues: { volume: { inputSource: 'expression', expression: 'PROGRESS + END_TIME_MS / 1000 + TIME_MS / 1000' } } });
	const trimmed = { ...original, trimStartMs: 40, trimmedDurationMs: 80 };
	const whole = await renderer.render([original], 0, 200, 1000);
	const part = await renderer.render([trimmed], 40, 80, 1000);
	assert.deepEqual(part[0], whole[0].slice(40, 120));
	assert.equal(part[0][0], Math.fround(0.2 + 0.2 + 0.04));
});

// 【終端合わせの音声キーフレームは元ファイルの末尾を基準にする】
// 右端をトリムしたときにフェードの位置がトリム端へ移動するのを防ぐ。
test('aligns end-relative audio keyframes to the source duration', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'end', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'start', x: 0, value: [0], interpolation: { type: 'linear' } },
			{ id: 'end', x: 100, value: [1], interpolation: { type: 'linear' } },
		] } };
	const pcm = await renderer.render([layer({ positionMs: 0, trimStartMs: 100, trimmedDurationMs: 60, paramValues: { volume: binding } })], 150, 1, 1000);
	assert.equal(pcm[0][0], 0.5);
});

// 【holdの境界を音声制御周期でぼかさない】
// キーフレームを5ms制御周期に丸めると、フェードやミュートの指定位置が変わってしまう。
test('preserves sub-control-period hold boundaries and linear keyframes', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 20, value: [0], interpolation: { type: 'hold' } },
			{ id: 'b', x: 22, value: [1], interpolation: { type: 'linear' } },
			{ id: 'c', x: 24, value: [0], interpolation: { type: 'linear' } },
		] } };
	const output = await renderer.render([layer({ paramValues: { volume: binding } })], 100, 6, 1000);
	assert.deepEqual([...output[0]], [0, 0, 1, 0.5, 0, 0]);
});

// 【不正な音量は無音にし、増幅値はレイヤー単位ではクリップしない】
// NaNを音声出力に流さず、重ね合わせ前に音量情報を失わない。
test('sanitizes invalid gains and permits amplification', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	for (const value of [-1, NaN, Infinity, 'bad']) {
		const output = await renderer.render([layer({ paramValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000);
		assert.deepEqual([...output[0]], [0, 0]);
	}
	assert.equal((await renderer.render([layer({ paramValues: { volume: { inputSource: 'literal', value: 3 } } })], 100, 1, 1000))[0][0], 3);
});

// 【Sceneの各階層の音量と子の素材時刻を同時に適用する】
// 展開した配置の開始を素材の先頭と誤認したり、親の音量を加算したりしない。
// チャンク分割を変えても同じサンプル列を生成し、末端のTIME変数は元の素材時刻を指す。
test('mixes scene gains using local clocks independently of chunk boundaries', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => 1000);
	const clip = {
		layer: layer({ paramValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 100' } } }),
		positionMs: 1150, startMs: 1180, endMs: 1280,
		gains: [
			{ positionMs: 1000, endTimeMs: 280, volume: { inputSource: 'literal', value: 2 }, automationGraphs: [] },
			{ positionMs: 1050, endTimeMs: 250, volume: { inputSource: 'literal', value: 0.25 }, automationGraphs: [] },
		],
	};
	const whole = await renderer.renderClips([clip], 1170, 120, 1000);
	const first = await renderer.renderClips([clip], 1170, 47, 1000);
	const second = await renderer.renderClips([clip], 1217, 73, 1000);
	assert.deepEqual(calls[0], ['asset', 0.03, 100, 1000]);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.deepEqual([...whole[0].slice(0, 10)], Array(10).fill(0));
	assert.equal(whole[0][10], Math.fround(0.15));
	assert.deepEqual([...whole[0].slice(110)], Array(10).fill(0));
});

// 【Scene音量と音声素材の式はそれぞれのスコープだけを使う】
// スコープを共通の生成関数へ移しても、Sceneに子素材のTIMEやPROGRESSを公開せず、
// 同名グラフは所有者ごとに解決する。書き出しかどうかは両スコープへ明示的に渡す。
test('isolates scene gain variables and graphs from the audio layer scope', async () => {
	const expression = expression => ({ inputSource: 'expression', expression });
	const graph = value => ({ id: 'shared', name: 'Shared', isNormalized: true,
		points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const renderer = new TimelineAudioRenderer(constant, async () => 1000);
	const clip = {
		layer: layer({ paramValues: { volume: expression('if IS_EXPORT { PROGRESS + GRAPH("Shared", 0, "clamp") } else { 0 }') }, automationGraphs: [graph(0.25)] }),
		positionMs: 1000, startMs: 1400, endMs: 1600,
		gains: [{ positionMs: 900, endTimeMs: 700,
			volume: expression('if IS_EXPORT { TEST_SAME_NAME + GRAPH("Shared", 0, "clamp") } else { 0 }'), automationGraphs: [graph(0.5)] }],
	};
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, true))[0][0], 1.875);
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, false))[0][0], 0);
	for (const variable of ['TIME', 'TIME_MS', 'END_TIME', 'END_TIME_MS', 'PROGRESS']) {
		clip.gains[0].volume = expression(variable);
		assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, true))[0][0], 0);
	}
});
