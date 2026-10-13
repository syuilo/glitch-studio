import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTimelineVideoHoldTrimBounds, trimTimelineVideoHold, validateTimelineVideoHoldTiming } from '../src/layers/video/video-hold.ts';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { getSceneDuration, validateTimelineLayerStructure } = await loadSource(fileURLToPath(new URL('../src/scenes.ts', import.meta.url)));
const { getSceneAudioClips } = await loadSource(fileURLToPath(new URL('../src/scene-audio.ts', import.meta.url)));
const { getTimelineMotionBlurLoops } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));

const clip = { id: 'hold', startMs: 1000, durationMs: 9000, sourceTimeMs: 2000.25, assetId: 'movie', audioEnabled: false };

// 【固定地点だけを素材長で検証し、表示長は素材長から独立させる】
// 通常再生と同じ検証を使うと長い静止表示が拒否される。二つの時計を同時に持つデータも拒否し、
// 利用側によって固定表示・通常再生の解釈が変わらないようにする。
test('validates hold points independently of duration and rejects ambiguous timing', () => {
	validateTimelineVideoHoldTiming(clip, 3000);
	for (const patch of [{ sourceTimeMs: -1 }, { sourceTimeMs: 3000 }, { sourceTimeMs: NaN }, { durationMs: 0 },
		{ durationMs: 1.5 }, { playbackRate: 0 }, { sourceInMs: 0 }, { loop: false }, { contentOffsetMs: 0 }]) {
		assert.throws(() => validateTimelineVideoHoldTiming({ ...clip, ...patch }, 3000));
	}
});

// 【固定クリップの両端は隣接配置まで延長でき、固定地点を変えない】
// 左トリムを通常再生へ接続すると素材時刻まで進んでしまう。素材の残り時間で表示長を制限せず、
// タイムラインの先頭・隣のクリップ・最小1msという配置の制約だけを使う。
test('extends either edge while preserving the hold point and neighboring clips', () => {
	const clips = [clip, { id: 'next', startMs: 12000, durationMs: 1000 }];
	assert.deepEqual(getTimelineVideoHoldTrimBounds(clips, clip, 'start'), { minDelta: -1000, maxDelta: 8999 });
	assert.deepEqual(getTimelineVideoHoldTrimBounds(clips, clip, 'end'), { minDelta: -8999, maxDelta: 2000 });
	const left = trimTimelineVideoHold(clip, 'start', -1000);
	assert.deepEqual(left, { ...clip, startMs: 0, durationMs: 10000 });
	assert.deepEqual(trimTimelineVideoHold(left, 'end', 2000), { ...clip, startMs: 0, durationMs: 12000 });
});

// 【同じ動画レイヤーの通常再生だけを音声計画・ループ計画へ含める】
// 固定表示を通常の素材時計へ渡すと無音PCMの計画や無効な周期を作ってしまう。
// 子Sceneやグループ内の配置でも静止表示がSceneの長さを維持することを確認する。
test('keeps held video silent through nested scenes while planning normal playback', () => {
	const normal = { id: 'normal', startMs: 10000, durationMs: 2000, sourceInMs: 0, sourceOutMs: 1000,
		playbackRate: 1, loop: true, assetId: 'movie', audioEnabled: true };
	const video = { id: 'video', layerType: 'video', isDisabled: false, forceDisableMotionBlur: false,
		clips: [clip, normal], compositingParamValues: {}, automationGraphs: [], audioParamValues: { volume: { inputSource: 'literal', value: 1 } } };
	validateTimelineLayerStructure(video);
	assert.throws(() => validateTimelineLayerStructure({ ...video, clips: [{ ...clip, audioEnabled: true }] }), /silent/);
	const child = { id: 'child', layers: [{ id: 'group', layerType: 'group', layers: [video],
		automationGraphs: [], audioParamValues: video.audioParamValues }] };
	const root = { id: 'root', layers: [{ id: 'scene-layer', layerType: 'scene', automationGraphs: [], audioParamValues: video.audioParamValues,
		clips: [{ id: 'scene-clip', sceneId: 'child', startMs: 500, durationMs: 12000, contentOffsetMs: 0 }] }] };
	const scenes = [root, child];
	assert.equal(getSceneDuration(child), 12000);
	assert.equal(getSceneDuration(root), 12500);
	const audio = getSceneAudioClips(scenes, 'root');
	assert.equal(audio.length, 1);
	assert.deepEqual([audio[0].startMs, audio[0].endMs], [10500, 12500]);
	assert.equal(getTimelineMotionBlurLoops(scenes, 'root').length, 1);
});
