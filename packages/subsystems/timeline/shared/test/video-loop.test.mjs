import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';
import { getTimelineMediaSourceTime, getTimelineMediaTrimBounds, getTimelineMediaLoopBounds, trimTimelineMediaClip, validateTimelineMediaClipTiming } from '../src/media-timing.ts';

const { getSceneAudioClips } = await loadSource(fileURLToPath(new URL('../src/scene-audio.ts', import.meta.url)));
const { getTimelineMotionBlurBoundaries, getTimelineMotionBlurLoops, getTimelineSampleTimes } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const clip = () => ({ id: 'clip', startMs: 1000, durationMs: 8000, sourceInMs: 2000.25, sourceOutMs: 5000.25, playbackRate: 1, loop: true });

// 【トリム範囲だけを繰り返し、境界は次の周の先頭に属する】
// 途中シーク・小数時刻・逆順の評価でも再生履歴に依存せず、素材の未使用部分へ進まない。
test('maps arbitrary seeks and exact loop boundaries to the trimmed source', () => {
	const video = clip();
	for (const [time, source] of [[1000, 2000.25], [3999.5, 4999.75], [4000, 2000.25], [8999, 3999.25], [7000, 2000.25], [2500, 3500.25]]) {
		assert.equal(getTimelineMediaSourceTime(video, time), source);
	}
	assert.equal(getTimelineMediaSourceTime({ ...video, loop: false }, 7000), 8000.25);
	for (const playbackRate of [undefined, 0, Infinity, NaN]) assert.throws(() => validateTimelineMediaClipTiming({ ...video, playbackRate }), /media timing/);
});

// 【ループ中のトリムは全体終端を保ち、追加ハンドルだけが全体長を変える】
// 素材長は周期、隣のクリップは全体長へ作用する。左トリムで最初の一周を消すことは許可しない。
test('separates source trim bounds from loop extension bounds', () => {
	const video = clip();
	const clips = [video, { id: 'next', startMs: 11000, durationMs: 1000, contentOffsetMs: 0 }];
	assert.deepEqual(getTimelineMediaLoopBounds(clips, video), { minDelta: -5000, maxDelta: 2000 });
	assert.deepEqual(getTimelineMediaTrimBounds(clips, video, 'end', 6000.25), { minDelta: -2999, maxDelta: 1000 });
	assert.deepEqual(getTimelineMediaTrimBounds(clips, video, 'start', 6000.25), { minDelta: -1000, maxDelta: 2999 });
	assert.deepEqual(trimTimelineMediaClip(video, 'start', 500), { id: 'clip', startMs: 1500, durationMs: 7500, sourceInMs: 2500.25, sourceOutMs: 5000.25, playbackRate: 1, loop: true });
	assert.deepEqual(trimTimelineMediaClip(video, 'end', -1000), { id: 'clip', startMs: 1000, durationMs: 8000, sourceInMs: 2000.25, sourceOutMs: 4000.25, playbackRate: 1, loop: true });
	assert.equal(trimTimelineMediaClip(video, 'end', 5000).loop, false);
});

// 【親Sceneが途中から表示しても、子の音声と露光のループ原点を変更しない】
// 親の表示開始を周期の原点にすると、同じ子Sceneの映像と音声が異なる位相になる。
// 下層音声・指定レイヤー音声も同じ音声計画を使い、音声無効時は計画から除外する。
test('preserves loop phase through nested scene clipping and audio selections', () => {
	const video = { id: 'video', layerType: 'video', isDisabled: false, clips: [{ ...clip(), assetId: 'movie', audioEnabled: true }],
		automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const parent = { id: 'parent', layerType: 'scene', isDisabled: false, clips: [{ id: 'placement', sceneId: 'child', startMs: 5000, durationMs: 4500, contentOffsetMs: 2500 }],
		automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });
	const scenes = [scene('root', [parent]), scene('child', [video])];
	const [audio] = getSceneAudioClips(scenes, 'root');
	assert.deepEqual([audio.startMs, audio.endMs], [5000, 9500]);
	assert.deepEqual(audio.sourceTiming, { startMs: 3500, sourceInMs: 2000.25, sourceOutMs: 5000.25, playbackRate: 1, loop: true });
	assert.equal(audio.gains[1].sceneStartMs, 2500);
	assert.deepEqual(getSceneAudioClips(scenes, 'root', { type: 'layer', layerId: 'parent' }), [audio]);
	const boundaries = getTimelineMotionBlurBoundaries(scenes, 'root');
	const loops = getTimelineMotionBlurLoops(scenes, 'root');
	assert.deepEqual(loops, [{ startMs: 5000, endMs: 9500, loopStartMs: 3500, loopDurationMs: 3000 }]);
	const samples = getTimelineSampleTimes(6500, 30, { enabled: true, shutterAngle: 360, samples: 8 }, boundaries, loops);
	assert.ok(samples.every(time => time >= 6500 && time < 9500));
	video.clips[0].audioEnabled = false;
	assert.deepEqual(getSceneAudioClips(scenes, 'root'), []);
});

// 【非常に短い周期を長時間繰り返しても音声計画と露光境界を巨大化させない】
// 全周期の展開は編集時のメモリと応答性を損なうため、計画は一件、露光境界は前後だけにする。
test('keeps long short-period loops compact', () => {
	const video = { id: 'video', layerType: 'video', isDisabled: false,
		clips: [{ ...clip(), durationMs: 3600000, sourceOutMs: 2001.25, assetId: 'movie', audioEnabled: true }],
		automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const scenes = [{ id: 'scene', resolution: { mode: 'project' }, layers: [video] }];
	assert.equal(getSceneAudioClips(scenes, 'scene').length, 1);
	const loops = getTimelineMotionBlurLoops(scenes, 'scene');
	assert.deepEqual(loops, [{ startMs: 1000, endMs: 3601000, loopStartMs: 1000, loopDurationMs: 1 }]);
	const samples = getTimelineSampleTimes(1800000.5, 30, { enabled: true, shutterAngle: 360, samples: 8 }, getTimelineMotionBlurBoundaries(scenes, 'scene'), loops);
	assert.ok(samples.every(time => time > 1800000 && time < 1800001));
});

// 【速度変更で小数になった周期の境界で、前の周の映像を露光に混ぜない】
// 周期を整数msとして扱ったり丸め誤差で前の周へ分類すると、ループ境界だけ残像が発生する。
// 素材時刻・音声計画と同じ周期を使い、逆再生でも露光はScene時刻で決める。
test('keeps motion blur inside the new cycle at fractional reverse loop boundaries', () => {
	const reversed = { ...clip(), sourceInMs: 0, sourceOutMs: 1000, playbackRate: -3 };
	const scenes = [{ id: 'root', resolution: { mode: 'project' }, layers: [
		{ id: 'video', layerType: 'video', isDisabled: false, clips: [reversed] },
	] }];
	const loops = getTimelineMotionBlurLoops(scenes, 'root');
	const boundaries = getTimelineMotionBlurBoundaries(scenes, 'root');
	assert.equal(loops[0].loopDurationMs, 1000 / 3);
	for (const cycle of [1, 2, 7, 11]) {
		const time = reversed.startMs + cycle * loops[0].loopDurationMs;
		assert.equal(getTimelineMediaSourceTime(reversed, time), 1000);
		const samples = getTimelineSampleTimes(time, 30, { enabled: true, shutterAngle: 360, samples: 8 }, boundaries, loops);
		assert.ok(samples.every(sample => sample >= time && sample < time + loops[0].loopDurationMs));
	}
});
