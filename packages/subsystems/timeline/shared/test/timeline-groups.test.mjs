import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = name => loadSource(fileURLToPath(new URL('../src/' + name, import.meta.url)));
const { getSceneDuration, canReferenceScene } = await load('scenes.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getTimelineMotionBlurBoundaries } = await load('motion-blur.ts');
const { resolveTimelineAnotherLayerAudioReference } = await load('timeline-audio.ts');
const { timelineSceneToSource, timelineSourceToScene } = await load('layer-transform.ts');
const { getTimelineContainerRange } = await load('container-range.ts');
const literal = value => ({ inputSource: 'literal', value });
const sound = (id, startMs = 100, durationMs = 100) => ({ id, name: id, layerType: 'audio', isDisabled: false,
	automationGraphs: [], audioParamValues: { volume: literal(0.8) }, clips: [{ id: 'clip', startMs, durationMs, sourceInMs: 12.5, sourceOutMs: 12.5 + durationMs, playbackRate: 1, loop: false, assetId: id }] });
const group = (id, layers) => ({ id, name: id, layerType: 'group', layers, isDisabled: false, automationGraphs: [],
	compositingParamValues: {}, audioParamValues: { volume: literal(0.5) } });
const scene = (id, layers) => ({ id, name: id, resolution: { mode: 'project' }, layers });

// 【Transform境界を越える下層音声でも各レイヤー本来のカスタム参照範囲を保つ】
// 選択した枝だけで索引を作ったり、最初の枝の祖先を全候補へ渡したりすると、外側の音声が誤った親を参照する。
test('retains distinct custom parameter ancestors for lower audio across Transform boundaries', () => {
	const inside = sound('inside');
	const outside = sound('outside');
	const visual = { id: 'visual', layerType: 'visualModule', name: '', clips: [], automationGraphs: [] };
	const definition = { id: 'gain', nameForReference: 'gain', dataType: { kind: 'scalar' }, ui: { label: 'Gain', control: { controlType: 'number' } }, defaultValue: literal(1) };
	const parent = { id: 'parent', name: 'Parent', layerType: 'transform', isDisabled: false, automationGraphs: [], layers: [visual, inside], customParameterDefs: [definition] };
	outside.customParameterDefs = [definition];
	const root = scene('root', [parent, outside]);
	const clips = getSceneAudioClips([root], root.id, { type: 'belowLayer', layerId: visual.id });
	assert.deepEqual(clips.map(clip => clip.sourceId), ['inside', 'outside']);
	assert.deepEqual(clips.map(clip => clip.gains.at(-1).customParameters.ancestors.map(owner => owner.id)), [['parent'], []]);
	assert.deepEqual(clips.map(clip => clip.gains.map(gain => gain.volume.value)), [[0.8], [0.8]]);
});

// 【直接参照では祖先の音量を除外し、無効化は引き継ぐ】
// グループ間を移動してもID参照を維持しつつ、無効化した枝から音声が漏れないようにする。
test('references any layer in the scene without ancestor gains and honors ancestor disabling', () => {
	const child = sound('sound');
	const inner = group('inner', [child]);
	const outer = group('outer', [inner]);
	const root = scene('root', [outer]);
	assert.equal(resolveTimelineAnotherLayerAudioReference(root, 'visual', child.id), child);
	assert.deepEqual(getSceneAudioClips([root], 'root')[0].gains.map(gain => gain.volume.value), [0.5, 0.5, 0.8]);
	assert.deepEqual(getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'inner' })[0].gains.map(gain => gain.volume.value), [0.5, 0.8]);
	const direct = () => getSceneAudioClips([root], 'root', { type: 'layer', layerId: 'sound' });
	assert.deepEqual(direct()[0].gains.map(gain => gain.volume.value), [0.8]);
	assert.deepEqual([direct()[0].startMs, (direct()[0].sourceTiming.startMs - direct()[0].sourceTiming.sourceInMs)], [100, 87.5]);
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
	assert.deepEqual(getTimelineContainerRange(nested), { startMs: 100, durationMs: 600 });
	assert.equal(getSceneDuration(root), 700);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root, child], 'root'), [0, 100, 200, 500, 700]);
	nested.isDisabled = true;
	assert.equal(getSceneDuration(root), 700);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root, child], 'root'), [0, 700]);
	assert.equal(getTimelineContainerRange(group('empty', [])), null);
});

// 【参照先の選択可否はグループ内のScene参照も考慮する】
// 入れ子へ移しただけで循環を作る参照先が選べるようにならないことを保証する。
test('rejects scene reference selections that introduce cycles through groups', () => {
	const placement = { ...sound('placement'), layerType: 'scene', compositingParamValues: {},
		clips: [{ id: 'clip', startMs: 0, durationMs: 10, contentOffsetMs: 0, sceneId: 'child' }] };
	const root = scene('root', [group('g', [placement])]);
	const child = scene('child', []);
	assert.equal(canReferenceScene([root, child], 'root', 'child'), true);
	assert.equal(canReferenceScene([root, child], 'child', 'root'), false);
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
