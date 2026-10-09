import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = name => loadSource(fileURLToPath(new URL('../src/' + name, import.meta.url)));
const { getSceneDuration, validateTimelineScenes, canReferenceScene } = await load('scenes.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getTimelineMotionBlurBoundaries } = await load('motion-blur.ts');
const { resolveTimelineAudioLayerReference } = await load('timeline-audio.ts');
const { timelineSceneToSource, timelineSourceToScene } = await load('layer-transform.ts');
const { getTimelineGroupRange } = await load('layers/group/group.ts');
const literal = value => ({ inputSource: 'literal', value });
const sound = (id, startMs = 100, durationMs = 100) => ({ id, name: id, layerType: 'audio', isDisabled: false,
	automationGraphs: [], audioParamValues: { volume: literal(0.8) }, clips: [{ id: 'clip', startMs, durationMs, contentOffsetMs: 12.5, assetId: id }] });
const group = (id, layers) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, automationGraphs: [],
	compositingParamValues: {}, audioParamValues: { volume: literal(0.5) } });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });

// 【直接参照では祖先の音量を除外し、無効化は引き継ぐ】
// グループ間を移動してもID参照を維持しつつ、無効化した枝から音声が漏れないようにする。
test('references any layer in the scene without ancestor gains and honors ancestor disabling', () => {
	const child = sound('sound');
	const inner = group('inner', [child]);
	const outer = group('outer', [inner]);
	const root = scene('root', [outer]);
	assert.equal(resolveTimelineAudioLayerReference(root, 'visual', child.id), child);
	assert.deepEqual(getSceneAudioClips([root], 'root')[0].gains.map(gain => gain.volume.value), [0.5, 0.5, 0.8]);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'inner' })[0].gains.map(gain => gain.volume.value), [0.5, 0.8]);
	const direct = () => getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'sound' });
	assert.deepEqual(direct()[0].gains.map(gain => gain.volume.value), [0.8]);
	assert.deepEqual([direct()[0].startMs, direct()[0].sourceStartMs], [100, 87.5]);
	outer.audioParamValues.volume = literal(0);
	assert.equal(direct().length, 1);
	outer.isDisabled = true;
	assert.deepEqual(direct(), []);
	outer.isDisabled = false;
	assert.equal(direct().length, 1);
});

// 【下層音声は同じ親の下層だけを読む】
// 指定レイヤー参照の自由度を広げても、下層入力がグループ外の音声を取り込んではいけない。
test('keeps lower-layer audio inside its parent while allowing explicit cross-group references', () => {
	const visual = { id: 'visual', layerType: 'visualModule', name: '', clips: [], visualModuleParamValues: {}, compositingParamValues: {}, automationGraphs: [] };
	const root = scene('root', [group('group', [sound('above'), visual, group('below', [sound('inside')])]), sound('outside')]);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'belowLayer', layerId: 'visual' }).map(clip => clip.sourceId), ['inside']);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'outside' }).map(clip => clip.sourceId), ['outside']);
});

// 【配置範囲とブラー境界は子孫を辿り、別Sceneの長さは配置を伸ばさない】
// 仮想クリップの空白と非表示の期間も保存上の範囲に含めるが、無効なカットで露光を切らない。
test('derives group ranges and scene duration without retiming referenced scenes', () => {
	const image = { ...sound('image', 100, 100), layerType: 'image', compositingParamValues: {} };
	const placement = { ...sound('placement', 500, 200), layerType: 'scene', compositingParamValues: {},
		clips: [{ id: 'clip', startMs: 500, durationMs: 200, contentOffsetMs: 0, sceneId: 'child' }] };
	const nested = group('nested', [image, group('inner', [placement])]);
	const root = scene('root', [nested]);
	const child = scene('child', [sound('long', 0, 10000)]);
	assert.deepEqual(getTimelineGroupRange(nested), { startMs: 100, durationMs: 600 });
	assert.equal(getSceneDuration(root), 700);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root, child], 'root'), [0, 100, 200, 500, 700]);
	nested.isDisabled = true;
	assert.equal(getSceneDuration(root), 700);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root, child], 'root'), [0, 700]);
	assert.equal(getTimelineGroupRange(group('empty', [])), null);
});

// 【Scene参照とレイヤーIDの検証はグループ境界を越える】
// 入れ子へ移しただけで循環や重複IDが見逃されると、描画と編集の対象が不定になる。
test('rejects duplicate IDs and scene cycles hidden inside groups', () => {
	const root = scene('root', [sound('same'), group('g', [sound('same')])]);
	assert.throws(() => validateTimelineScenes([root]), /Duplicate layer ID/);
	const placement = { ...sound('placement'), layerType: 'scene', compositingParamValues: {},
		clips: [{ id: 'clip', startMs: 0, durationMs: 10, contentOffsetMs: 0, sceneId: 'root' }] };
	root.layers = [group('g', [placement])];
	assert.throws(() => validateTimelineScenes([root]), /Circular scene reference/);
	assert.equal(canReferenceScene([root], 'root', 'root'), false);
});

// 【非等方拡縮・回転・反転のある祖先でもポインターを元の座標へ戻す】
// グループ内の素材を直接編集するとき、画面上の差分をそのまま子へ適用してはいけない。
test('inverts nested group transforms including reflections and nonuniform scales', () => {
	const geometry = { sourceSize: { width: 1920, height: 1080 }, sceneSize: { width: 1920, height: 1080 },
		transform: { position: [0.3, -0.2], origin: [-0.1, 0.7], scale: [-2, 0.3], rotation: 0.37, fitMode: 'contain' } };
	const original = [0.2, -0.4];
	const restored = timelineSceneToSource(timelineSourceToScene(original, geometry), geometry);
	assert.ok(restored.every((value, index) => Math.abs(value - original[index]) < 1e-10));
	geometry.transform.scale[0] = 0;
	assert.equal(timelineSceneToSource(original, geometry), null);
});
