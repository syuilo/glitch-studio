import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changeTimelineMediaPlaybackRate, getTimelineMediaPeriod, getTimelineMediaSourceTime, getTimelineMediaTrimBounds, trimTimelineMediaClip, validateTimelineMediaClipTiming } from '../src/media-timing.ts';

const clip = { id: 'clip', startMs: 1000, durationMs: 6000, sourceInMs: 2000, sourceOutMs: 8000, playbackRate: 1, loop: false };

// 【速度と方向を変えても、トリム済み素材範囲と配置開始を維持する】
// スローで別の映像が混ざったり、逆再生で素材全体の末尾に飛んだりしないための契約。
// 再生履歴を参照せず、途中から・逆順に評価しても同じ素材時刻を返す。
test('retimes a fixed source range for slow fast and reverse playback', () => {
	for (const rate of [0.5, 1, 2, -0.5, -1, -2]) {
		const changed = changeTimelineMediaPlaybackRate(clip, rate);
		assert.equal(changed.durationMs, 6000 / Math.abs(rate));
		assert.deepEqual([changed.sourceInMs, changed.sourceOutMs, changed.startMs], [2000, 8000, 1000]);
		assert.equal(getTimelineMediaSourceTime(changed, 1000), rate > 0 ? 2000 : 8000);
		for (const elapsed of [700, 0, 300]) assert.equal(getTimelineMediaSourceTime(changed, 1000 + elapsed), (rate > 0 ? 2000 : 8000) + elapsed * rate);
	}
});

// 【素材位置と周期の小数を保持し、保存する配置長だけを整数msへ丸める】
// 倍率を往復するたびに元のトリム範囲が削れたり、ループの誤差が累積したりしてはいけない。
test('preserves fractional source boundaries and loop phase without cumulative rounding', () => {
	const original = { ...clip, sourceInMs: 0.25, sourceOutMs: 1000.75, durationMs: 1000 };
	const fast = changeTimelineMediaPlaybackRate(original, 3);
	assert.equal(fast.durationMs, 333);
	assert.deepEqual(changeTimelineMediaPlaybackRate(fast, 1), original);
	const loop = { ...fast, loop: true, durationMs: 100000 };
	const period = getTimelineMediaPeriod(loop);
	for (const cycle of [0, 1, 33, 200]) assert.equal(getTimelineMediaSourceTime(loop, loop.startMs + period * cycle), original.sourceInMs);
	const reversed = changeTimelineMediaPlaybackRate({ ...clip, loop: true, durationMs: 16000 }, -2);
	assert.equal(reversed.durationMs, 8000);
	assert.equal(getTimelineMediaSourceTime(reversed, 4000), 8000);
});

// 【逆再生の左トリムは素材終端、右トリムは素材開始を動かす】
// タイムライン上の左右と素材上の左右を混同すると、逆再生だけ素材外へ延長できてしまう。
test('trims and constrains the appropriate source edge when reversed', () => {
	const reversed = changeTimelineMediaPlaybackRate(clip, -2);
	assert.deepEqual(getTimelineMediaTrimBounds([reversed], reversed, 'start', 10000), { minDelta: -1000, maxDelta: 2999 });
	assert.deepEqual(getTimelineMediaTrimBounds([reversed], reversed, 'end', 10000), { minDelta: -2999, maxDelta: 1000 });
	const left = trimTimelineMediaClip(reversed, 'start', 500);
	assert.deepEqual([left.startMs, left.durationMs, left.sourceInMs, left.sourceOutMs], [1500, 2500, 2000, 7000]);
	const right = trimTimelineMediaClip(reversed, 'end', -500);
	assert.deepEqual([right.startMs, right.durationMs, right.sourceInMs, right.sourceOutMs], [1000, 2500, 3000, 8000]);
	validateTimelineMediaClipTiming(left, 10000);
	validateTimelineMediaClipTiming(right, 10000);
});

// 【小数倍率の演算誤差で素材先頭への延長を1ms早く止めない】
// 0.3 / 0.1や0.3 - 3 * 0.1は整数・ゼロのわずか手前になることがある。
// 素材範囲の小数精度を保ちつつ、正当に延長可能な整数msを失わないことを確認する。
test('extends fractional source edges without losing a millisecond to rounding', () => {
	const fractional = { ...clip, sourceInMs: 0.3, sourceOutMs: 100.3, durationMs: 1000, playbackRate: 0.1 };
	assert.equal(getTimelineMediaTrimBounds([fractional], fractional, 'start', 100.6).minDelta, -3);
	const extended = trimTimelineMediaClip(fractional, 'start', -3);
	assert.equal(extended.sourceInMs, 0);
	assert.equal(extended.durationMs, 1003);
	validateTimelineMediaClipTiming(extended, 100.6);
});

// 【不正な倍率・空の素材範囲・素材超過を保存しない】
// 長さを計算できない0倍や、整数msで表せない短い配置を部分適用してしまうことを防ぐ。
test('rejects invalid rates ranges and durations', () => {
	for (const rate of [0, Infinity, NaN, 0.001, 10000]) assert.throws(() => changeTimelineMediaPlaybackRate(clip, rate));
	for (const rate of [0.01, -0.01, 16, -16]) validateTimelineMediaClipTiming(changeTimelineMediaPlaybackRate(clip, rate));
	for (const patch of [{ sourceInMs: -1 }, { sourceOutMs: 2000 }, { loop: undefined }, { durationMs: 3 }, { startMs: -1 }, { durationMs: Infinity, loop: true }]) assert.throws(() => validateTimelineMediaClipTiming({ ...clip, ...patch }));
	assert.throws(() => changeTimelineMediaPlaybackRate({ ...clip, sourceOutMs: 2001, durationMs: 1 }, 2), /duration/);
	assert.throws(() => validateTimelineMediaClipTiming(clip, 7999), /exceeds/);
});
