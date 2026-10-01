import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSceneDuration, validateTimelineScenes, canReferenceScene } from '../src/timeline/scenes.ts';
import { getSceneAudioClips } from '../src/timeline/scene-audio.ts';

const scene = (id, layers = []) => ({ id, name: id, layers });
const nested = (id, sceneId, positionMs, trimStartMs, trimmedDurationMs) => ({
	id, layerType: 'scene', sceneId, positionMs, trimStartMs, trimmedDurationMs,
	compositingParamValues: {}, audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [],
});
const audio = { id: 'audio', layerType: 'audio', assetId: 'asset', positionMs: 100, trimStartMs: 20, trimmedDurationMs: 200,
	paramValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };

// 【動画の音声も親Sceneのトリムと音量に従い、映像設定の変更では再生成しない】
// 音声へレイヤー全体を渡すとfitやopacityの編集でも先読みPCMを破棄してしまう。
// 音声無効化は再生計画だけを変え、素材位置やSceneの長さには影響しない。
test('collects video audio independently of visual settings and preserves scene trims', () => {
	const video = { id: 'video', layerType: 'video', assetId: 'movie', positionMs: 100, trimStartMs: 20, trimmedDurationMs: 200,
		audioEnabled: true, audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } },
		compositingParamValues: { fitMode: { inputSource: 'literal', value: 'contain' } }, automationGraphs: [] };
	const scenes = [scene('root', [nested('placement', 'child', 1000, 150, 100)]), scene('child', [video])];
	const [clip] = getSceneAudioClips(scenes, 'root');
	assert.deepEqual([clip.assetId, clip.positionMs, clip.startMs, clip.endMs, clip.durationBasis], ['movie', 1100, 1150, 1250, 'media']);
	assert.equal(clip.volume.value, 0.5);
	assert.equal(clip.gains.length, 1);
	video.compositingParamValues.fitMode = { inputSource: 'literal', value: 'cover' };
	video.compositingParamValues.opacity = { inputSource: 'literal', value: 0 };
	assert.deepEqual(getSceneAudioClips(scenes, 'root'), [clip]);
	video.audioEnabled = false;
	assert.deepEqual(getSceneAudioClips(scenes, 'root'), []);
	assert.equal(getSceneDuration(scenes[1]), 320);
});

// 【子Sceneの長さが変わっても親の配置期間を伸縮しない】
// 素材の編集によって祖先の尺まで変わることを防ぐ。無音のレイヤーも配置情報として数える。
test('derives duration from direct placements including silent layers', () => {
	const child = scene('child', [structuredClone(audio)]);
	const parent = scene('parent', [nested('placement', 'child', 1000, 20, 500)]);
	assert.equal(getSceneDuration(parent), 1520);
	child.layers[0].trimmedDurationMs = 10000;
	child.layers[0].paramValues.volume.value = 0;
	assert.equal(getSceneDuration(child), 10120);
	assert.equal(getSceneDuration(parent), 1520);
	assert.equal(getSceneDuration(scene('empty')), 0);
});

// 【共有Sceneの複数配置は許可し、参照経路に戻る循環だけを拒否する】
// 全訪問済みIDを循環扱いすると正当な再利用も拒否される。間接循環も描画開始前に検出する。
test('accepts shared descendants and rejects direct and indirect cycles', () => {
	const root = scene('root', [nested('a', 'child', 0, 0, 100), nested('b', 'child', 100, 0, 100)]);
	const child = scene('child');
	validateTimelineScenes([root, child]);
	assert.equal(canReferenceScene([root, child], 'child', 'root'), false);
	assert.equal(canReferenceScene([root, child], 'root', 'child'), true);
	child.layers.push(nested('back', 'root', 0, 0, 100));
	assert.throws(() => validateTimelineScenes([root, child]), /Circular scene reference/);
	assert.throws(() => validateTimelineScenes([scene('self', [nested('self-layer', 'self', 0, 0, 100)])]), /Circular scene reference/);
	assert.throws(() => validateTimelineScenes([root]), /Scene not found/);
});

// 【多段トリムは祖先の区間を交差させ、元の音量キーと素材時刻を移動しない】
// 親時刻へ展開するときにtrimStartを二重加算したり、音量の評価基準を表示開始へ変えたりしない。
test('intersects ancestor windows while retaining independent content clocks', () => {
	const leaf = scene('leaf', [structuredClone(audio)]);
	const child = scene('child', [nested('inner', 'leaf', 50, 100, 150)]);
	const root = scene('root', [nested('outer', 'child', 1000, 180, 100)]);
	const [clip] = getSceneAudioClips([root, child, leaf], 'root');
	assert.equal(clip.assetId, leaf.layers[0].assetId);
	assert.equal(clip.volume, leaf.layers[0].paramValues.volume);
	assert.deepEqual([clip.startMs, clip.endMs, clip.positionMs], [1180, 1280, 1150]);
	assert.deepEqual(clip.gains.map(gain => [gain.positionMs, gain.endTimeMs]), [[1000, 280], [1050, 250]]);
	leaf.layers[0].trimmedDurationMs = 50;
	const [shortened] = getSceneAudioClips([root, child, leaf], 'root');
	assert.equal(shortened.endMs, 1220);
	assert.equal(getSceneDuration(root), 1280);
});

// 【同じ音声Sceneを複数配置した場合、各配置を別の再生対象にする】
// Scene IDだけで音声を一意化すると、異なる時刻に置いた二つ目以降が消えてしまう。
test('keeps repeated audio scene placements and handles empty children', () => {
	const child = scene('child', [structuredClone(audio)]);
	const root = scene('root', [nested('a', 'child', 0, 0, 400), nested('b', 'child', 1000, 0, 400)]);
	const clips = getSceneAudioClips([root, child], 'root');
	assert.deepEqual(clips.map(clip => [clip.startMs, clip.endMs, clip.positionMs]), [[120, 320, 100], [1120, 1320, 1100]]);
	child.layers = [];
	assert.deepEqual(getSceneAudioClips([root, child], 'root'), []);
	assert.equal(getSceneDuration(root), 1400);
});
