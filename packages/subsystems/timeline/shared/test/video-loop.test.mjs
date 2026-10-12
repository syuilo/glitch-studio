import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';
import { getTimelineVideoSourceTime, getTimelineVideoTrimBounds, getTimelineVideoLoopBounds, trimTimelineVideoClip, validateTimelineVideoClipTiming } from '../src/layers/video/video-timing.ts';

const { getSceneAudioClips } = await loadSource(fileURLToPath(new URL('../src/scene-audio.ts', import.meta.url)));
const { getTimelineMotionBlurBoundaries, getTimelineMotionBlurLoopBoundaries, getTimelineSampleTimes } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const clip = () => ({ id: 'clip', startMs: 1000, durationMs: 8000, contentOffsetMs: 2000.25, loopDurationMs: 3000 });

// 【トリム範囲だけを繰り返し、境界は次の周の先頭に属する】
// 途中シーク・小数時刻・逆順の評価でも再生履歴に依存せず、素材の未使用部分へ進まない。
test('maps arbitrary seeks and exact loop boundaries to the trimmed source', () => {
	const video = clip();
	for (const [time, source] of [[1000, 2000.25], [3999.5, 4999.75], [4000, 2000.25], [8999, 3999.25], [7000, 2000.25], [2500, 3500.25]]) {
		assert.equal(getTimelineVideoSourceTime(video, time), source);
	}
	assert.equal(getTimelineVideoSourceTime({ ...video, loopDurationMs: null }, 7000), 8000.25);
	for (const period of [undefined, 0, -1, 0.5, 8001, Infinity, NaN]) assert.throws(() => validateTimelineVideoClipTiming({ ...video, loopDurationMs: period }), /loop duration/);
});

// 【ループ中のトリムは全体終端を保ち、追加ハンドルだけが全体長を変える】
// 素材長は周期、隣のクリップは全体長へ作用する。左トリムで最初の一周を消すことは許可しない。
test('separates source trim bounds from loop extension bounds', () => {
	const video = clip();
	const clips = [video, { id: 'next', startMs: 11000, durationMs: 1000, contentOffsetMs: 0 }];
	assert.deepEqual(getTimelineVideoLoopBounds(clips, video), { minDelta: -5000, maxDelta: 2000 });
	assert.deepEqual(getTimelineVideoTrimBounds(clips, video, 'end', 6000.25), { minDelta: -2999, maxDelta: 1000 });
	assert.deepEqual(getTimelineVideoTrimBounds(clips, video, 'start', 6000.25), { minDelta: -1000, maxDelta: 2999 });
	assert.deepEqual(trimTimelineVideoClip(video, 'start', 500), { startMs: 1500, durationMs: 7500, contentOffsetMs: 2500.25, loopDurationMs: 2500 });
	assert.deepEqual(trimTimelineVideoClip(video, 'end', -1000), { startMs: 1000, durationMs: 8000, contentOffsetMs: 2000.25, loopDurationMs: 2000 });
	assert.equal(trimTimelineVideoClip(video, 'end', 5000).loopDurationMs, null);
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
	assert.deepEqual(audio.loop, { startMs: 3500, durationMs: 3000, contentOffsetMs: 2000.25 });
	assert.equal(audio.gains[1].sceneStartMs, 2500);
	assert.deepEqual(getSceneAudioClips(scenes, 'root', { type: 'layer', layerId: 'parent' }), [audio]);
	const boundaries = [...getTimelineMotionBlurBoundaries(scenes, 'root'), ...getTimelineMotionBlurLoopBoundaries(scenes, 'root', 6500)].sort((a, b) => a - b);
	const samples = getTimelineSampleTimes(6500, 30, { enabled: true, shutterAngle: 360, samples: 8 }, boundaries);
	assert.ok(samples.every(time => time >= 6500 && time < 9500));
	video.clips[0].audioEnabled = false;
	assert.deepEqual(getSceneAudioClips(scenes, 'root'), []);
});

// 【非常に短い周期を長時間繰り返しても音声計画と露光境界を巨大化させない】
// 全周期の展開は編集時のメモリと応答性を損なうため、計画は一件、露光境界は前後だけにする。
test('keeps long short-period loops compact', () => {
	const video = { id: 'video', layerType: 'video', isDisabled: false,
		clips: [{ ...clip(), durationMs: 3600000, loopDurationMs: 1, assetId: 'movie', audioEnabled: true }],
		automationGraphs: [], compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	const scenes = [{ id: 'scene', resolution: { mode: 'project' }, layers: [video] }];
	assert.equal(getSceneAudioClips(scenes, 'scene').length, 1);
	assert.deepEqual(getTimelineMotionBlurLoopBoundaries(scenes, 'scene', 1800000.5), [1800000, 1800001]);
});
