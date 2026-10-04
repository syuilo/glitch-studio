import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from '../../renderer/test/helpers/load-shader-source.mjs';

const { TimelineAudioRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-audio-renderer.ts', import.meta.url)));
const layer = (changes = {}) => ({ id: 'audio', layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 20, durationMs: 100, assetId: 'asset' }], audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [], ...changes });

// 【動画の音量はScene時刻で評価し、素材時刻は独立して読み出す】
// 音量キーを素材時刻へずらすと、クリップの移動やトリムでレイヤーの設定が変わってしまう。
// PCMは同じ素材時刻で読み、音声だけを先頭へ詰め直さない。
test('uses scene time for video volume without shifting audio timestamps', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async (assetId, basis) => {
		assert.equal(assetId, 'movie');
		assert.equal(basis, 'media');
		return 4000;
	});
	const clip = { assetId: 'movie', sourceStartMs: 8000, startMs: 10000, endMs: 11000, durationBasis: 'media',
		gains: [{ sceneStartMs: 0, volume: { inputSource: 'expression', expression: 'TIME_MS / 20000' }, automationGraphs: [] }] };
	const result = await renderer.renderClips([clip], 10000, 1, 1000);
	assert.deepEqual(calls, [['movie', 2, 1, 1000]]);
	assert.equal(result[0][0], 0.5);
});
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(0.5)];

// 【非表示の音声レイヤーは素材を読み出さず、再表示すると元の時刻で音声を出力する】
// 音量0として評価すると不要なデコードやエラーが残るため、期間内でも完全にスキップする。
// 直接レイヤーを渡すAPIも、Sceneから展開する音声計画と同じ無効化仕様にする。
test('skips disabled audio layers before reading media in preview and export', async () => {
	for (const isExport of [false, true]) {
		const calls = [];
		const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => {
			calls.push('duration');
			return 200;
		});
		const hidden = layer({ isDisabled: true });
		const silence = await renderer.render([hidden], 150, 10, 1000, isExport);
		assert.deepEqual(calls, []);
		assert.deepEqual(silence, [new Float32Array(10), new Float32Array(10)]);
		hidden.isDisabled = false;
		const audible = await renderer.render([hidden], 150, 10, 1000, isExport);
		assert.deepEqual(calls, ['duration', ['asset', 0.07, 10, 1000]]);
		assert.deepEqual(audible[0], new Float32Array(10).fill(1));
	}
});

// 【素材の配置基準を固定した左トリムは、再生開始と読み出し位置を同じ量だけ進める】
// 表示開始とオフセットを同量進めても、トリム前の区間を再生せず右端を維持する。
test('trims audio relative to a fixed source origin', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => 200);
	const output = await renderer.render([layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 140, contentOffsetMs: 40, durationMs: 60, assetId: 'asset' }] })], 100, 110, 1000);
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
test('evaluates scene-time expressions consistently across chunk boundaries', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const layers = [layer({ audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 200' } } })];
	const whole = await renderer.render(layers, 100, 100, 1000);
	const first = await renderer.render(layers, 100, 37, 1000);
	const second = await renderer.render(layers, 137, 63, 1000);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.equal(whole[0][50], Math.fround(150 / 200));
});

// 【音声の両端をトリムしても同じScene時刻の音量は変えない】
// 音量はレイヤー所有なので、クリップの長さとオフセットは音量の時計に影響しない。
test('keeps expression timing unchanged when either audio edge is trimmed', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const original = layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 200, assetId: 'asset' }],
		audioParamValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / 1000' } } });
	const trimmed = { ...original, clips: [{ ...original.clips[0], startMs: 40, contentOffsetMs: 40, durationMs: 80 }] };
	const whole = await renderer.render([original], 0, 200, 1000);
	const part = await renderer.render([trimmed], 40, 80, 1000);
	assert.deepEqual(part[0], whole[0].slice(40, 120));
	assert.equal(part[0][0], Math.fround(0.04));
});

// 【音量のキーを所属Scene上の絶対時刻で評価する】
// 左端をトリムしても、フェードの位置をクリップの開始へ移動させない。
test('evaluates audio keyframes at absolute scene times', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'start', x: 100, value: 0, interpolation: { type: 'linear' } },
			{ id: 'end', x: 200, value: 1, interpolation: { type: 'linear' } },
		] } };
	const pcm = await renderer.render([layer({ name: 'Layer', clips: [{ id: 'clip', startMs: 100, contentOffsetMs: 100, durationMs: 60, assetId: 'asset' }], audioParamValues: { volume: binding } })], 150, 1, 1000);
	assert.equal(pcm[0][0], 0.5);
});

// 【holdの境界を音声制御周期でぼかさない】
// キーフレームを5ms制御周期に丸めると、フェードやミュートの指定位置が変わってしまう。
test('preserves sub-control-period hold boundaries and linear keyframes', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 100, value: 0, interpolation: { type: 'hold' } },
			{ id: 'b', x: 102, value: 1, interpolation: { type: 'linear' } },
			{ id: 'c', x: 104, value: 0, interpolation: { type: 'linear' } },
		] } };
	const output = await renderer.render([layer({ audioParamValues: { volume: binding } })], 100, 6, 1000);
	assert.deepEqual([...output[0]], [0, 0, 1, 0.5, 0, 0]);
});

// 【不正な音量は無音にし、増幅値はレイヤー単位ではクリップしない】
// NaNを音声出力に流さず、重ね合わせ前に音量情報を失わない。
test('sanitizes invalid gains and permits amplification', async () => {
	const renderer = new TimelineAudioRenderer(constant, async () => 200);
	for (const value of [-1, NaN, Infinity, 'bad']) {
		const output = await renderer.render([layer({ audioParamValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000);
		assert.deepEqual([...output[0]], [0, 0]);
	}
	assert.equal((await renderer.render([layer({ audioParamValues: { volume: { inputSource: 'literal', value: 3 } } })], 100, 1, 1000))[0][0], 3);
});

// 【Sceneの各階層の音量と子の素材時刻を同時に適用する】
// 展開した配置の開始を素材の先頭と誤認したり、親の音量を加算したりしない。
// チャンク分割を変えても同じサンプル列を生成し、末端のTIME変数は所属Sceneの時刻を指す。
test('mixes scene gains using local clocks independently of chunk boundaries', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); }, async () => 1000);
	const clip = {
		assetId: 'asset', durationBasis: 'audio',
		sourceStartMs: 1150, startMs: 1180, endMs: 1280,
		gains: [
			{ sceneStartMs: 0, volume: { inputSource: 'literal', value: 2 }, automationGraphs: [] },
			{ sceneStartMs: 1000, volume: { inputSource: 'literal', value: 0.25 }, automationGraphs: [] },
			{ sceneStartMs: 1050, volume: { inputSource: 'expression', expression: 'TIME_MS / 100' }, automationGraphs: [] },
		],
	};
	const whole = await renderer.renderClips([clip], 1170, 120, 1000);
	const first = await renderer.renderClips([clip], 1170, 47, 1000);
	const second = await renderer.renderClips([clip], 1217, 73, 1000);
	assert.deepEqual(calls[0], ['asset', 0.03, 100, 1000]);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.deepEqual([...whole[0].slice(0, 10)], Array(10).fill(0));
	assert.equal(whole[0][10], Math.fround(0.65));
	assert.deepEqual([...whole[0].slice(110)], Array(10).fill(0));
});

// 【Scene音量と音声素材の式はそれぞれのスコープだけを使う】
// 各階層は所属SceneのTIMEを持ち、クリップ専用のPROGRESSやEND_TIMEを公開せず、
// 同名グラフは所有者ごとに解決する。書き出しかどうかは両スコープへ明示的に渡す。
test('isolates scene gain variables and graphs from the audio layer scope', async () => {
	const expression = expression => ({ inputSource: 'expression', expression });
	const graph = value => ({ id: 'shared', name: 'Shared', isNormalized: true,
		points: [{ id: 'point', x: 0, y: value, bezierControlPointA: [0, 0], bezierControlPointB: [0, 0] }] });
	const renderer = new TimelineAudioRenderer(constant, async () => 1000);
	const clip = {
		assetId: 'asset', durationBasis: 'audio',
		sourceStartMs: 1000, startMs: 1400, endMs: 1600,
		gains: [{ sceneStartMs: 900,
			volume: expression('if IS_EXPORT { TEST_SAME_NAME + GRAPH("Shared", 0, "clamp") } else { 0 }'), automationGraphs: [graph(0.5)] }, { sceneStartMs: 1000,
			volume: expression('if IS_EXPORT { TIME + GRAPH("Shared", 0, "clamp") } else { 0 }'), automationGraphs: [graph(0.25)] }],
	};
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, true))[0][0], 1.875);
	assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, false))[0][0], 0);
	for (const variable of ['END_TIME', 'END_TIME_MS', 'PROGRESS']) {
		clip.gains[0].volume = expression(variable);
		assert.equal((await renderer.renderClips([clip], 1500, 1, 1000, true))[0][0], 0);
	}
});
