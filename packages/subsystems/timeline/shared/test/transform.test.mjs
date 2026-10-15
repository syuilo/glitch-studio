import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const load = path => loadSource(fileURLToPath(new URL('../src/' + path, import.meta.url)));
const { createTimelineTransformParameterValues } = await load('layers/transform/transform.ts');
const { TimelineTransformParameters } = await load('layers/transform/transform-parameters.ts');
const { createTimelineCameraParameterValues, DEFAULT_CAMERA_DISTANCE } = await load('layers/camera/camera.ts');
const { TimelineSceneCamera, TimelineCameraCuts, getActiveTimelineCamera } = await load('scene-camera.ts');
const { getSceneDuration } = await load('scenes.ts');
const { getSceneAudioClips } = await load('scene-audio.ts');
const { getTimelineContainerRange } = await load('container-range.ts');
const { getTimelineMotionBlurCameraCuts, getTimelineMotionBlurBoundaries } = await load('motion-blur.ts');
const { getTimelinePreviewParent } = await load('group-space.ts');
const { TIMELINE_IDENTITY, projectTimelineMatrix, multiplyTimelineAffine } = await load('spatial.ts');
const { getTimelineTransformSpace } = await load('transform-space.ts');
const { transformTimelinePoint, invertTimelineAffine } = await load('affine.ts');
const frame = { width: 1920, height: 1080 };
const identityTransform = { position: [0, 0], z: 0, scale: [1, 1], rotation: 0 };
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
	const evaluate = () => evaluator.evaluate([outer], 500, true, frame, 400);
	assert.deepEqual(evaluate(), { position: [1.5, 0.5], z: DEFAULT_CAMERA_DISTANCE + 0.75, roll: 0, fieldOfView: 45 });
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
	const view = new TimelineSceneCamera().evaluate([camera('camera')], 0, false, frame);
	const root = { parent: TIMELINE_IDENTITY, depth: 0, camera: view };
	const transform = { ...identityTransform, position: [0.3, 0.2], z: 0.5 };
	const preview = (ancestors, own = settings) => getTimelinePreviewParent(ancestors, own, frame, root);
	near(preview([{ transform }]), projectTimelineMatrix([1, 0, 0, 1, 0.3, 0.2], 0.5, frame, view));
	near(preview([{ transform }], { ...settings, coordinateSpace: 'screen' }), [1, 0, 0, 1, 0.3, 0.2]);
	const flat = { settings: { ...settings, position: [-0.3, 0], depth: 0.25 }, compositingMode: 'flat' };
	near(preview([{ transform }, flat, { transform: { ...identityTransform, position: [0.1, 0], z: 100 } }]),
		multiplyTimelineAffine(projectTimelineMatrix([1, 0, 0, 1, 0, 0.2], 0.75, frame, view), [1, 0, 0, 1, 0.1, 0]));
});

// 【Transformの式はレイヤー共通の評価変数を使い、不正数値を座標へ流さない】
// NaNや無限大が投影行列へ混ざると、親以下のレイヤーをまとめて描画できなくなる。
test('evaluates transform variables and sanitizes non-finite coordinates', () => {
	const evaluator = new TimelineTransformParameters();
	const values = createTimelineTransformParameterValues();
	near(evaluator.evaluate({ ...values, position: expression('[0.02 * Math:sin(TIME * 20), 0]') }, [], 250, true).position, [0.02 * Math.sin(5), 0]);
	assert.deepEqual(evaluator.evaluate({ ...values, position: expression('[TIME, TIME_MS]'), z: expression('if IS_EXPORT { 1 } else { 0 }'),
		scale: expression('[1 + TIME, -2]'), rotation: expression('TIME') }, [], 250, true),
	{ position: [0.25, 250], z: 1, scale: [1.25, -2], rotation: 0.25 });
	assert.deepEqual(evaluator.evaluate({ ...values, position: literal([Infinity, 0.5]), z: literal(NaN), scale: literal([NaN, 0]), rotation: literal(Infinity) }, [], 0, false),
		{ position: [0, 0.5], z: 0, scale: [1, 0], rotation: 0 });
});

// 【非等方scaleと子の回転を、せん断を含む行列として継承する】
// scaleの積とrotationの和へ戻すと、親の軸に沿った拡縮が子の軸に変わってしまう。
// 横長Sceneでの縦横比補正、親による子の位置の拡縮、操作座標の逆変換も確認する。
test('preserves shear and child positions when composing nonuniform scale and rotation', () => {
	const wide = { width: 200, height: 100 };
	const outer = getTimelineTransformSpace({ ...identityTransform, position: [0.2, 0.3], scale: [2, 1] }, wide);
	const inner = getTimelineTransformSpace({ ...identityTransform, position: [0.1, 0.2], rotation: 0.25 }, wide, outer);
	const c = Math.SQRT1_2;
	near(inner.parent, [2 * c, -2 * c, c, c, 0.4, 0.5]);
	near(inner.screenParent, inner.parent);
	const [a, b, x, y] = inner.parent;
	assert.ok(Math.abs((a * 2) * (x * 2) + b * y) > 1, 'Transformed axes must not remain perpendicular');
	const point = [0.4, -0.2];
	near(transformTimelinePoint(invertTimelineAffine(inner.parent), transformTimelinePoint(inner.parent, point)), point);
	const reversed = getTimelineTransformSpace({ ...identityTransform, scale: [2, 1] }, wide,
		getTimelineTransformSpace({ ...identityTransform, rotation: 0.25 }, wide));
	assert.notDeepEqual(inner.parent.slice(0, 4), reversed.parent.slice(0, 4));
});

// 【親のscaleはカメラ位置だけに適用し、ロールと画角を歪めない】
// 親子の移動は行列の順序で合成しなければならない。一方、非等方scaleや反転から
// 向きを抽出すると、カメラが意図しない方向へ回転したり画面が伸縮してしまう。
test('transforms camera positions through nested matrices while inheriting rotation independently', () => {
	const square = { width: 100, height: 100 };
	const child = camera('camera');
	Object.assign(child.cameraParamValues, { position: literal([0.5, 1]), z: literal(2), roll: literal(0.125), fieldOfView: literal(60) });
	const inner = transform('inner', [child], { position: literal([1, 2]), scale: literal([-4, 0.5]), rotation: literal(0.25), z: literal(0.25) });
	const outer = transform('outer', [inner], { position: literal([10, 20]), scale: literal([2, 3]), rotation: literal(0.5), z: literal(0.5) });
	const evaluator = new TimelineSceneCamera();
	const evaluated = evaluator.evaluate([outer], 0, false, square);
	const c = Math.SQRT1_2;
	const innerPosition = [1 - 1.5 * c, 2 + 2.5 * c];
	near(evaluated.position, [10 + 3 * innerPosition[1], 20 - 2 * innerPosition[0]]);
	assert.equal(evaluated.z, 2.75);
	assert.equal(evaluated.roll, 0.875);
	assert.equal(evaluated.fieldOfView, 60);
	outer.transformParamValues.scale = literal([-2, 0]);
	const collapsed = evaluator.evaluate([outer], 0, false, square);
	near(collapsed.position, [10, 20 + 2 * innerPosition[0]]);
	assert.equal(collapsed.roll, 0.875);
	assert.equal(collapsed.fieldOfView, 60);
	assert.deepEqual(child.cameraParamValues.position.value, [0.5, 1]);
});

// 【親の拡縮・回転とカメラのロールを、それぞれのブラー固定時刻で評価する】
// カメラだけの固定で親の回転まで止めたり、親を固定しても子のロールが進んではいけない。
// 位置と向きの継承経路が分かれていても、同じScene時計の規則を保つ必要がある。
test('freezes animated scale, rotation and camera roll at the correct hierarchy boundary', () => {
	const child = camera('camera');
	Object.assign(child.cameraParamValues, { position: literal([1, 0]), roll: expression('TIME') });
	const parent = transform('parent', [child], { scale: expression('[1 + TIME, 1]'), rotation: expression('TIME') });
	const evaluator = new TimelineSceneCamera();
	const evaluate = () => evaluator.evaluate([parent], 500, true, frame, 400);
	near(evaluate().position, [0, -1.5 * frame.width / frame.height]);
	assert.equal(evaluate().roll, 1);
	child.forceDisableMotionBlur = true;
	near(evaluate().position, [0, -1.5 * frame.width / frame.height]);
	assert.equal(evaluate().roll, 0.9);
	parent.forceDisableMotionBlur = true;
	near(evaluate().position, [1.4 * Math.cos(0.4 * Math.PI), -1.4 * Math.sin(0.4 * Math.PI) * frame.width / frame.height]);
	assert.equal(evaluate().roll, 0.8);
});

// 【プレビューでも回転・せん断・カメラロールを同じ境界で適用する】
// On screenはカメラを無視して親Transformを継承する。平面化された内部の変換は
// 外側の投影へ一度だけ重なり、ポインターを子の座標へ戻せる必要がある。
test('keeps rotated preview coordinates consistent across screen and flat boundaries', () => {
	const settings = { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'stretch', coordinateSpace: 'world', depth: 0 };
	const view = new TimelineSceneCamera().evaluate([camera('camera')], 0, false, frame);
	view.roll = 0.2;
	const root = { parent: TIMELINE_IDENTITY, depth: 0, camera: view };
	const outer = { ...identityTransform, scale: [2, 1], rotation: 0.1, z: 0.5 };
	const inner = { ...identityTransform, position: [0.3, -0.1], rotation: 0.25, z: 100 };
	const parent = getTimelineTransformSpace(outer, frame).parent;
	const local = getTimelineTransformSpace(inner, frame).parent;
	near(getTimelinePreviewParent([{ transform: outer }, { transform: inner }], { ...settings, coordinateSpace: 'screen' }, frame, root),
		multiplyTimelineAffine(parent, local));
	const preview = getTimelinePreviewParent([{ transform: outer }, { settings, compositingMode: 'flat' }, { transform: inner }], settings, frame, root);
	near(preview, multiplyTimelineAffine(projectTimelineMatrix(parent, 0.5, frame, view), local));
	near(transformTimelinePoint(invertTimelineAffine(preview), transformTimelinePoint(preview, [0.4, 0.2])), [0.4, 0.2]);
});
