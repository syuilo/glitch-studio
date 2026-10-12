import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { DEFAULT_CAMERA_DISTANCE } = await loadSource(fileURLToPath(new URL('../src/layers/camera/camera.ts', import.meta.url)));
const { projectTimelineMatrix, TIMELINE_IDENTITY, timelineGeometryMatrix, multiplyTimelineAffine, transformTimelinePoint, invertTimelineAffine } = await loadSource(fileURLToPath(new URL('../src/spatial.ts', import.meta.url)));
const { getTimelinePreviewParent } = await loadSource(fileURLToPath(new URL('../src/group-space.ts', import.meta.url)));
const { TimelineCameraParameters } = await loadSource(fileURLToPath(new URL('../src/layers/camera/camera-parameters.ts', import.meta.url)));
const evaluator = new TimelineCameraParameters();
const { TimelineSceneCamera, getActiveTimelineCamera } = await loadSource(fileURLToPath(new URL('../src/scene-camera.ts', import.meta.url)));
const { validateTimelineScenes } = await loadSource(fileURLToPath(new URL('../src/scenes.ts', import.meta.url)));
const { getTimelineMotionBlurBoundaries, getTimelineSampleTimes } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const camera = evaluator.evaluate(undefined, 0, false);
const frame = { width: 1920, height: 1080 };
const settings = { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'contain', placement: 'world', depth: 0 };
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} != ${expected}`));
const parent = (ancestors, own = settings) => getTimelinePreviewParent(ancestors, own, frame, { parent: TIMELINE_IDENTITY, depth: 0, camera });

const cameraLayer = (id, startMs, durationMs, paramValues = {}) => ({
	id, name: id, layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false,
	automationGraphs: [], cameraParamValues: paramValues,
	clips: [{ id: 'view', startMs, durationMs, contentOffsetMs: 300 }],
});

// 【最上段の有効なカメラを選び、無効化・空白区間・並べ替えを反映する】
// カメラの順序は映像合成の順序と別に解決し、該当なしでは前フレームの視点を残さない。
test('selects the topmost active camera and restores the default during gaps', () => {
	const upper = cameraLayer('upper', 100, 200, { z: { inputSource: 'literal', value: 4 } });
	const lower = cameraLayer('lower', 0, 500, { z: { inputSource: 'literal', value: 8 } });
	const sceneCamera = new TimelineSceneCamera();
	assert.equal(getActiveTimelineCamera([upper, lower], 99).layer.id, 'lower');
	assert.equal(getActiveTimelineCamera([upper, lower], 100).layer.id, 'upper');
	assert.equal(getActiveTimelineCamera([upper, lower], 300).layer.id, 'lower');
	assert.equal(getActiveTimelineCamera([upper, lower], 500), undefined);
	assert.equal(sceneCamera.evaluate([lower, upper], 150, false).z, 8);
	assert.equal(sceneCamera.evaluate([{ ...upper, isDisabled: true }, lower], 150, false).z, 8);
	assert.deepEqual(sceneCamera.evaluate([upper, lower], 500, false), camera);
});

// 【カメラのキーはクリップのトリムに依存せず、ブラー無効時だけ基準時刻へ固定する】
// 通常のレイヤー同様Scene時計を使い、クリップの移動・分割でアニメーションの原点を変えない。
test('evaluates camera animation in scene time with an independent motion blur override', () => {
	const animated = cameraLayer('animated', 100, 1000, { position: { inputSource: 'expression', expression: '[TIME, 0]' } });
	const sceneCamera = new TimelineSceneCamera();
	assert.deepEqual(sceneCamera.evaluate([animated], 500, true, 400).position, [0.5, 0]);
	assert.deepEqual(sceneCamera.evaluate([{ ...animated, forceDisableMotionBlur: true }], 500, true, 400).position, [0.4, 0]);
	assert.equal(getActiveTimelineCamera([{ ...animated, forceDisableMotionBlur: true }], 99, 100).layer.id, animated.id);
	assert.equal(getActiveTimelineCamera([{ ...animated, forceDisableMotionBlur: true }], 100, 99), undefined);
});

// 【カメラの切り替え境界で露光を制限し、グループ内部のカメラは拒否する】
// カットをまたいだ視点を平均すると意図しない二重像になる。Scene限定の配置も読み込み時に保証する。
test('clips motion blur at camera cuts and rejects cameras inside groups', () => {
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [cameraLayer('first', 0, 100), cameraLayer('second', 100, 200)] };
	const boundaries = getTimelineMotionBlurBoundaries([scene], scene.id);
	assert.deepEqual(boundaries, [0, 100, 300]);
	const samples = getTimelineSampleTimes(100, 60, { enabled: true, shutterAngle: 360, samples: 8 }, boundaries);
	assert.ok(samples.every(time => time >= 100));
	validateTimelineScenes([scene]);
	assert.throws(() => validateTimelineScenes([{ ...scene, layers: [{ id: 'group', layerType: 'group', layers: scene.layers }] }]), /directly in a Scene/);
});

// 【基準カメラはZ=0の従来の配置を維持する】
// 解像度・横長比率や支点を含む既存の2D変形に、暗黙の拡大や平行移動を加えない。
test('keeps the reference plane unchanged and projects positive depth toward the camera', () => {
	near(projectTimelineMatrix(TIMELINE_IDENTITY, 0, camera), TIMELINE_IDENTITY);
	near(projectTimelineMatrix(TIMELINE_IDENTITY, DEFAULT_CAMERA_DISTANCE / 2, camera), [2, 0, 0, 2, 0, 0]);
	const matrix = timelineGeometryMatrix({ sourceSize: { width: 1000, height: 1000 }, sceneSize: frame, transform: { ...settings, position: [0.3, -0.2], origin: [1, 0], scale: [-2, 0.4], rotation: 0.2 } });
	near(projectTimelineMatrix(matrix, 0, camera), matrix);
	near(transformTimelinePoint(invertTimelineAffine(matrix), transformTimelinePoint(matrix, [0.2, 0.4])), [0.2, 0.4]);
});

// 【カメラと重なった平面や背後の平面を投影しない】
// 距離0による無限大テクスチャや、背後の左右反転像を発生させない。
test('excludes planes at the near limit and behind the camera', () => {
	for (const depth of [camera.z, camera.z + 1, camera.z - 0.0001]) assert.equal(projectTimelineMatrix(TIMELINE_IDENTITY, depth, camera), null);
});

// 【式とキーは所属Sceneの時計・書き出し状態で評価する】
// カメラだけ別の単位や未定義の変数を使うと、シーク・書き出しと一致しなくなる。
test('evaluates camera expressions and keyframes at scene sample time', () => {
	const result = evaluator.evaluate({ automationGraphs: [], paramValues: {
		position: { inputSource: 'expression', expression: '[TIME, TIME_MS / 1000]' },
		z: { inputSource: 'envVariable', variable: 'TIME' },
		fieldOfView: { inputSource: 'keyframesTimelineInline', offsetMode: 'start', trimmedDurationMs: null, wrapMode: 'clamp', keyframesTimeline: {
			dataType: { kind: 'scalar' }, isNormalized: false, keyframes: [
				{ id: 'a', x: 0, value: 40, interpolation: { type: 'linear' } },
				{ id: 'b', x: 1000, value: 60, interpolation: { type: 'linear' } },
			],
		} },
	} }, 500, true);
	assert.deepEqual(result, { position: [0.5, 0.5], z: 0.5, fieldOfView: 50 });
});

// 【平面化境界より内側のZを無視し、外側のZだけで投影する】
// 入れ子の内部を再投影すると二重に拡大され、ドラッグ枠も描画位置からずれる。
test('matches preview coordinates across flat and preserved depth boundaries', () => {
	const outer = { compositingMode: 'preserveDepth', settings: { ...settings, position: [0.2, 0], depth: 0.5 } };
	const flat = { compositingMode: 'flat', settings: { ...settings, position: [-0.2, 0.4], depth: 0.5 } };
	const inner = { compositingMode: 'preserveDepth', settings: { ...settings, position: [0.5, 0], depth: 100 } };
	const expected = multiplyTimelineAffine(projectTimelineMatrix([1, 0, 0, 1, 0, 0.4], 1, camera), [1, 0, 0, 1, 0.5, 0]);
	near(parent([outer, flat, inner], { ...settings, depth: 200 }), expected);
	near(parent([outer], { ...settings, depth: 0.5 }), projectTimelineMatrix([1, 0, 0, 1, 0.2, 0], 1, camera));
});

// 【画面配置は投影済みの親変形を二重に受けない】
// 画面フィルターは奥行き維持グループ内でも画面座標を使う。一方、平面化境界の外側の配置は残す。
test('resets preserved transforms for screen placement inside the current flat boundary', () => {
	const outer = { compositingMode: 'preserveDepth', settings: { ...settings, depth: 1, position: [0.3, 0.5] } };
	near(parent([outer], { ...settings, placement: 'screen' }), TIMELINE_IDENTITY);
	near(parent([{ ...outer, compositingMode: 'flat' }], { ...settings, placement: 'screen' }), projectTimelineMatrix([1, 0, 0, 1, 0.3, 0.5], 1, camera));
});
