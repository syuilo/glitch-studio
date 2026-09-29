import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadShaderSource } from '../../renderer/test/helpers/load-shader-source.mjs';

const { TimelineAudioRenderer } = await loadShaderSource(fileURLToPath(new URL('../src/timeline-audio-renderer.ts', import.meta.url)));
const layer = (changes = {}) => ({ id: 'audio', layerType: 'audio', assetId: 'asset', startTimeMs: 100, durationMs: 100, sourceOffsetMs: 20, paramValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [], ...changes });
const constant = async (_id, _time, frames) => [new Float32Array(frames).fill(1), new Float32Array(frames).fill(0.5)];

// 【レイヤーの期間と素材オフセットを独立して扱う】
// 途中シークやトリミングで素材の先頭を再生せず、半開区間の外は無音にする。
test('mixes overlapping layers with source offsets and exclusive ends', async () => {
	const calls = [];
	const renderer = new TimelineAudioRenderer(async (...args) => { calls.push(args); return constant(...args); });
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
	const renderer = new TimelineAudioRenderer(constant);
	const layers = [layer({ paramValues: { volume: { inputSource: 'expression', expression: 'TIME_MS / END_TIME_MS' } } })];
	const whole = await renderer.render(layers, 100, 100, 1000);
	const first = await renderer.render(layers, 100, 37, 1000);
	const second = await renderer.render(layers, 137, 63, 1000);
	assert.deepEqual([...whole[0]], [...first[0], ...second[0]]);
	assert.equal(whole[0][50], 0.5);
});

// 【holdの境界を音声制御周期でぼかさない】
// キーフレームを5ms制御周期に丸めると、フェードやミュートの指定位置が変わってしまう。
test('preserves sub-control-period hold boundaries and linear keyframes', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	const binding = { inputSource: 'keyframesTimelineInline', offsetMode: 'start', wrapMode: 'clamp', durationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
			{ id: 'a', x: 0, value: [0], interpolation: { type: 'hold' } },
			{ id: 'b', x: 2, value: [1], interpolation: { type: 'linear' } },
			{ id: 'c', x: 4, value: [0], interpolation: { type: 'linear' } },
		] } };
	const output = await renderer.render([layer({ paramValues: { volume: binding } })], 100, 6, 1000);
	assert.deepEqual([...output[0]], [0, 0, 1, 0.5, 0, 0]);
});

// 【不正な音量は無音にし、増幅値はレイヤー単位ではクリップしない】
// NaNを音声出力に流さず、重ね合わせ前に音量情報を失わない。
test('sanitizes invalid gains and permits amplification', async () => {
	const renderer = new TimelineAudioRenderer(constant);
	for (const value of [-1, NaN, Infinity, 'bad']) {
		const output = await renderer.render([layer({ paramValues: { volume: { inputSource: 'literal', value } } })], 100, 2, 1000);
		assert.deepEqual([...output[0]], [0, 0]);
	}
	assert.equal((await renderer.render([layer({ paramValues: { volume: { inputSource: 'literal', value: 3 } } })], 100, 1, 1000))[0][0], 3);
});
