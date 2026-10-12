import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = path => loadSource(fileURLToPath(new URL('../src/' + path, import.meta.url)));
const { createTimelineTransformParameterValues } = await load('layers/transform/transform.ts');
const { TimelineTransformParameters } = await load('layers/transform/transform-parameters.ts');
const { createTimelineCameraParameterValues, DEFAULT_CAMERA_DISTANCE } = await load('layers/camera/camera.ts');
const { TimelineSceneCamera, TimelineCameraCuts, getActiveTimelineCamera } = await load('scene-camera.ts');
const { validateTimelineScenes, getSceneDuration } = await load('scenes.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getTimelineContainerRange } = await load('container-range.ts');
const { getTimelineMotionBlurCameraCuts, getTimelineMotionBlurBoundaries } = await load('motion-blur.ts');
const { getTimelinePreviewParent } = await load('group-space.ts');
const { TIMELINE_IDENTITY, projectTimelineMatrix, multiplyTimelineAffine } = await load('spatial.ts');
const literal = value => ({ inputSource: 'literal', value });
const expression = expression => ({ inputSource: 'expression', expression });
const common = id => ({ id, name: id, automationGraphs: [], isDisabled: false, forceDisableMotionBlur: false });
const transform = (id, layers, values = {}) => ({ ...common(id), layerType: 'transform', layers, transformParamValues: { ...createTimelineTransformParameterValues(), ...values } });
const camera = (id, startMs = 0, durationMs = 1000) => ({ ...common(id), layerType: 'camera', cameraParamValues: createTimelineCameraParameterValues(), clips: [{ id: 'clip', startMs, durationMs, contentOffsetMs: 0 }] });
const group = layers => ({ ...common('group'), layerType: 'group', layers, compositingParamValues: {}, audioParamValues: { volume: literal(0.5) } });
const scene = layers => ({ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers });
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} != ${expected}`));

// 【親の揺れと子カメラの移動をScene時計で合成する】
// カメラだけを固定しても親の動きは残し、祖先を固定した場合はそこから下を固定する。
// 入れ子のXYZ加算と再評価の決定性を検証し、評価結果を保存値へ書き戻す退行も防ぐ。
test('composes nested camera motion with independently frozen ancestors and children', () => {
	const child = camera('camera');
	child.cameraParamValues.position = expression('[TIME, 0]');
	const inner = transform('inner', [child], { position: expression('[TIME * 2, 0]'), z: literal(0.25) });
	const outer = transform('outer', [inner], { position: expression('[0, TIME]'), z: literal(0.5) });
	const evaluator = new TimelineSceneCamera();
	const evaluate = () => evaluator.evaluate([outer], 500, true, 400);
	assert.deepEqual(evaluate(), { position: [1.5, 0.5], z: DEFAULT_CAMERA_DISTANCE + 0.75, fieldOfView: 45 });
	assert.deepEqual(evaluate(), evaluate());
	child.forceDisableMotionBlur = true;
	near(evaluate().position, [1.4, 0.5]);
	inner.forceDisableMotionBlur = true;
	near(evaluate().position, [1.2, 0.5]);
	outer.forceDisableMotionBlur = true;
	near(evaluate().position, [1.2, 0.4]);
	assert.equal(child.cameraParamValues.position.expression, '[TIME, 0]');
});

// 【Transform内部も表示順のカメラ候補とし、固定・無効化をカット計画へ反映する】
// 折りたたみや祖先の追加によって選択順が変わったり、無効な枝が露光を制限してはいけない。
test('selects cameras in depth-first order and plans cuts using inherited visibility and freezing', () => {
	const upper = camera('upper', 100, 100);
	const lower = camera('lower', 0, 500);
	const parent = transform('parent', [transform('inner', [upper])]);
	const layers = [parent, lower];
	validateTimelineScenes([scene(layers)]);
	assert.equal(getActiveTimelineCamera(layers, 150).layer.id, 'upper');
	assert.equal(getActiveTimelineCamera(layers, 200).layer.id, 'lower');
	assert.deepEqual(new TimelineCameraCuts(layers).getBoundaries(150), [0, 100, 200, 500]);
	assert.equal(getTimelineMotionBlurCameraCuts([scene(layers)], 'scene').length, 1);
	parent.forceDisableMotionBlur = true;
	assert.equal(getActiveTimelineCamera(layers, 201, 150).layer.id, 'upper');
	assert.equal(getActiveTimelineCamera(layers, 150, 99).layer.id, 'lower');
	assert.deepEqual(new TimelineCameraCuts(layers).getBoundaries(150), []);
	assert.deepEqual(new TimelineCameraCuts(layers).getBoundaries(99), [0, 500]);
	parent.isDisabled = true;
	assert.equal(getActiveTimelineCamera(layers, 150).layer.id, 'lower');
	assert.deepEqual(new TimelineCameraCuts(layers).getBoundaries(150), [0, 500]);
});



// 【Transformは音量・合成境界を増やさず、時間範囲と無効化は子孫を含める】
// 下層音声がTransformの外側まで届く一方、Groupの境界は越えないことを保証する。
test('passes audio and lower inputs through transforms while preserving group isolation', () => {
	const sound = id => ({ ...common(id), layerType: 'audio', audioParamValues: { volume: literal(0.8) },
		clips: [{ id: 'clip', startMs: 100, durationMs: 200, sourceInMs: 0, sourceOutMs: 200, playbackRate: 1, loop: false, assetId: id }] });
	const owner = { ...common('owner'), layerType: 'image', compositingParamValues: {}, clips: [] };
	const parent = transform('outer', [transform('inner', [owner, sound('inside')]), sound('sibling')]);
	const root = scene([parent, sound('outside')]);
	const below = () => getSceneAudioClips([root], root.id, { type: 'belowLayer', layerId: owner.id });
	assert.deepEqual(below().map(clip => clip.sourceId), ['inside', 'sibling', 'outside']);
	assert.ok(below().every(clip => clip.gains.length === 1));
	assert.deepEqual(getTimelineContainerRange(parent), { startMs: 100, durationMs: 200 });
	assert.equal(getSceneDuration(root), 300);
	root.layers = [group([parent]), sound('outside')];
	assert.deepEqual(below().map(clip => clip.sourceId), ['inside', 'sibling']);
	assert.deepEqual(getSceneAudioClips([root], root.id)[0].gains.map(gain => gain.volume.value), [0.5, 0.8]);
	parent.isDisabled = true;
	assert.deepEqual(below(), []);
	assert.deepEqual(getSceneAudioClips([root], root.id).map(clip => clip.sourceId), ['outside']);
});

// 【映像カットはTransformを再帰し、固定した枝だけ露光境界から除く】
// 自身にクリップを持たないことを、常に有効な映像クリップと誤認しないようにする。
test('finds visual boundaries through transforms without extending their children', () => {
	const child = { ...common('image'), layerType: 'image', compositingParamValues: {}, clips: [{ id: 'clip', startMs: 100, durationMs: 200, contentOffsetMs: 0, assetId: 'image' }] };
	const parent = transform('parent', [child]);
	const root = scene([parent]);
	assert.deepEqual(getTimelineMotionBlurBoundaries([root], root.id), [0, 100, 300]);
	parent.forceDisableMotionBlur = true;
	assert.deepEqual(getTimelineMotionBlurBoundaries([root], root.id), [0, 300]);
});

// 【プレビューの逆変換もTransformとGroupの境界を共有する】
// 平面化の内側ではZを使わず、On screenにはTransformのXYだけを反映する。
test('matches preview transforms across flat, preserved and screen spaces', () => {
	const settings = { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'stretch', coordinateSpace: 'world', depth: 0 };
	const frame = { width: 1920, height: 1080 };
	const view = new TimelineSceneCamera().evaluate([], 0, false);
	const root = { parent: TIMELINE_IDENTITY, depth: 0, camera: view };
	const translation = { position: [0.3, 0.2], z: 0.5 };
	const preview = (ancestors, own = settings) => getTimelinePreviewParent(ancestors, own, frame, root);
	near(preview([{ translation }]), projectTimelineMatrix([1, 0, 0, 1, 0.3, 0.2], 0.5, view));
	near(preview([{ translation }], { ...settings, coordinateSpace: 'screen' }), [1, 0, 0, 1, 0.3, 0.2]);
	const flat = { settings: { ...settings, position: [-0.3, 0], depth: 0.25 }, compositingMode: 'flat' };
	near(preview([{ translation }, flat, { translation: { position: [0.1, 0], z: 100 } }]),
		multiplyTimelineAffine(projectTimelineMatrix([1, 0, 0, 1, 0, 0.2], 0.75, view), [1, 0, 0, 1, 0.1, 0]));
});

// 【Transformの式はレイヤー共通の評価変数を使い、不正数値を座標へ流さない】
// NaNや無限大が投影行列へ混ざると、親以下のレイヤーをまとめて描画できなくなる。
test('evaluates transform variables and sanitizes non-finite coordinates', () => {
	const evaluator = new TimelineTransformParameters();
	near(evaluator.evaluate({ position: expression('[0.02 * Math:sin(TIME * 20), 0]'), z: literal(0) }, [], 250, true).position, [0.02 * Math.sin(5), 0]);
	assert.deepEqual(evaluator.evaluate({ position: expression('[TIME, TIME_MS]'), z: expression('if IS_EXPORT { 1 } else { 0 }') }, [], 250, true), { position: [0.25, 250], z: 1 });
	assert.deepEqual(evaluator.evaluate({ position: literal([Infinity, 0.5]), z: literal(NaN) }, [], 0, false), { position: [0, 0.5], z: 0 });
});
