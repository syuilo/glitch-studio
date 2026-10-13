import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadSource } from './helpers/load-source.mjs';

const { DEFAULT_CAMERA_DISTANCE } = await loadSource(fileURLToPath(new URL('../src/layers/camera/camera.ts', import.meta.url)));
const { projectTimelineMatrix, TIMELINE_IDENTITY, timelineGeometryMatrix, multiplyTimelineAffine, transformTimelinePoint, invertTimelineAffine } = await loadSource(fileURLToPath(new URL('../src/spatial.ts', import.meta.url)));
const { getTimelinePreviewParent } = await loadSource(fileURLToPath(new URL('../src/group-space.ts', import.meta.url)));
const { TimelineCameraParameters } = await loadSource(fileURLToPath(new URL('../src/layers/camera/camera-parameters.ts', import.meta.url)));
const evaluator = new TimelineCameraParameters();
const { TimelineSceneCamera, TimelineCameraCuts, getActiveTimelineCamera } = await loadSource(fileURLToPath(new URL('../src/scene-camera.ts', import.meta.url)));
const { getTimelineMotionBlurBoundaries, getTimelineMotionBlurCameraCuts, getTimelineSampleTimes } = await loadSource(fileURLToPath(new URL('../src/motion-blur.ts', import.meta.url)));
const camera = evaluator.evaluate(undefined, 0, false);
const frame = { width: 1920, height: 1080 };
const settings = { position: [0, 0], origin: [0, 0], scale: [1, 1], rotation: 0, fitMode: 'contain', coordinateSpace: 'world', depth: 0 };
const near = (actual, expected) => actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-9, `${actual} != ${expected}`));
const parent = (ancestors, own = settings) => getTimelinePreviewParent(ancestors, own, frame, { parent: TIMELINE_IDENTITY, depth: 0, camera });

const cameraLayer = (id, startMs, durationMs, paramValues = {}) => ({
	id, name: id, layerType: 'camera', isDisabled: false, forceDisableMotionBlur: false,
	automationGraphs: [], cameraParamValues: paramValues,
	clips: [{ id: 'view', startMs, durationMs, contentOffsetMs: 300 }],
});

// 【最上段の有効なカメラを選び、無効化・空白区間・並べ替えを反映する】
// カメラの順序は映像合成の順序と別に解決し、該当なしでは前フレームの視点を残さない。
test('selects the topmost active camera and disables projection during gaps', () => {
	const upper = cameraLayer('upper', 100, 200, { z: { inputSource: 'literal', value: 4 } });
	const lower = cameraLayer('lower', 0, 500, { z: { inputSource: 'literal', value: 8 } });
	const sceneCamera = new TimelineSceneCamera();
	assert.equal(getActiveTimelineCamera([upper, lower], 99).layer.id, 'lower');
	assert.equal(getActiveTimelineCamera([upper, lower], 100).layer.id, 'upper');
	assert.equal(getActiveTimelineCamera([upper, lower], 300).layer.id, 'lower');
	assert.equal(getActiveTimelineCamera([upper, lower], 500), null);
	assert.equal(sceneCamera.evaluate([lower, upper], 150, false).z, 8);
	assert.equal(sceneCamera.evaluate([{ ...upper, isDisabled: true }, lower], 150, false).z, 8);
	assert.equal(sceneCamera.evaluate([upper, lower], 500, false), null);
});

// 【有効なカメラがない区間ではZを変えても2D配置とプレビューを維持する】
// 未配置・無効化・クリップ外を同じ規則で扱い、近接面を越えるZでも消えないようにする。
// カメラの有効区間だけ透視投影へ切り替わり、終了後は元の配置へ戻る。
test('preserves 2D geometry at every depth without an active camera', () => {
	const sceneCamera = new TimelineSceneCamera();
	const entry = cameraLayer('camera', 100, 100);
	const matrix = [2, 0, 0, 3, 0.2, -0.3];
	for (const isExport of [false, true]) {
		for (const [layers, time] of [[[], 150], [[entry], 99], [[entry], 200], [[{ ...entry, isDisabled: true }], 150]]) {
			const view = sceneCamera.evaluate(layers, time, isExport);
			assert.equal(view, null);
			for (const depth of [-100, 0, 1, 100]) {
				assert.deepEqual(projectTimelineMatrix(matrix, depth, view), matrix);
				assert.deepEqual(getTimelinePreviewParent([], { ...settings, depth }, frame,
					{ parent: matrix, depth: 10, camera: view }), matrix);
			}
		}
		assert.notDeepEqual(projectTimelineMatrix(matrix, 1, sceneCamera.evaluate([entry], 100, isExport)), matrix);
	}
});

// 【カメラのキーはクリップのトリムに依存せず、ブラー無効時だけ基準時刻へ固定する】
// 通常のレイヤー同様Scene時計を使い、クリップの移動・分割でアニメーションの原点を変えない。
test('evaluates camera animation in scene time with an independent motion blur override', () => {
	const animated = cameraLayer('animated', 100, 1000, { position: { inputSource: 'expression', expression: '[TIME, 0]' } });
	const sceneCamera = new TimelineSceneCamera();
	assert.deepEqual(sceneCamera.evaluate([animated], 500, true, 400).position, [0.5, 0]);
	assert.deepEqual(sceneCamera.evaluate([{ ...animated, forceDisableMotionBlur: true }], 500, true, 400).position, [0.4, 0]);
	assert.equal(getActiveTimelineCamera([{ ...animated, forceDisableMotionBlur: true }], 99, 100).layer.id, animated.id);
	assert.equal(getActiveTimelineCamera([{ ...animated, forceDisableMotionBlur: true }], 100, 99), null);
});

// 【カメラの切り替え境界で露光を制限する】
// カットをまたいだ視点を平均すると意図しない二重像になるため、選択が変わる時刻で露光を切る。
test('clips motion blur at camera cuts', () => {
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [cameraLayer('first', 0, 100), cameraLayer('second', 100, 200)] };
	const boundaries = getTimelineMotionBlurBoundaries([scene], scene.id);
	const cameras = getTimelineMotionBlurCameraCuts([scene], scene.id);
	assert.deepEqual(boundaries, [0, 300]);
	assert.deepEqual(cameras[0].cuts.getBoundaries(100), [0, 100, 300]);
	const samples = getTimelineSampleTimes(100, 60, { enabled: true, shutterAngle: 360, samples: 8 }, boundaries, [], cameras);
	assert.ok(samples.every(time => time >= 100));
});





// 【上段に隠れたカメラの開始・終了で映像全体のブラーを短くしない】
// 未採用のカメラを追加しただけで露光が変わる退行を防ぐ。切り替えがない区間では
// カメラなしの場合と同じサンプル時刻を使い、基準時刻の前後へ均等に露光する。
test('ignores camera clips hidden behind a higher active camera', () => {
	const scene = { id: 'scene', layers: [cameraLayer('upper', 0, 1000), cameraLayer('hidden', 100, 100)] };
	const cameras = getTimelineMotionBlurCameraCuts([scene], scene.id);
	const boundaries = getTimelineMotionBlurBoundaries([scene], scene.id);
	const settings = { enabled: true, shutterAngle: 360, samples: 8 };
	assert.deepEqual(cameras[0].cuts.getBoundaries(100), [0, 1000]);
	for (const time of [99, 100, 199, 200]) {
		assert.deepEqual(getTimelineSampleTimes(time, 60, settings, boundaries, [], cameras), getTimelineSampleTimes(time, 60, settings, [0, 1000]));
	}
});

// 【優先順位・空白・隣接クリップを、描画時と同じカメラ選択で判定する】
// カメラが変わる区間は露光を区切る一方、同じレイヤーの連続クリップはScene時計と
// 設定を共有するためカットにしない。無効なカメラや並べ替えにも同じ規則を適用する。
test('retains effective camera cuts across gaps and priority changes without splitting adjacent clips', () => {
	const upper = cameraLayer('upper', 100, 200);
	const lower = cameraLayer('lower', 0, 500);
	const disabled = { ...cameraLayer('disabled', 50, 50), isDisabled: true };
	assert.deepEqual(new TimelineCameraCuts([disabled, upper, lower]).getBoundaries(150), [0, 100, 300, 500]);
	assert.deepEqual(new TimelineCameraCuts([lower, upper]).getBoundaries(150), [0, 500]);
	const split = { ...lower, clips: [
		{ id: 'a', startMs: 0, durationMs: 100 }, { id: 'b', startMs: 100, durationMs: 100 },
		{ id: 'c', startMs: 300, durationMs: 100 },
	] };
	assert.deepEqual(new TimelineCameraCuts([split]).getBoundaries(150), [0, 200, 300, 400]);
});

// 【ブラー無効のカメラは基準時刻で固定し、その間は下位のカットも無効にする】
// 固定カメラが開始する直前のフレームでは、その開始後のサンプルでも固定カメラは
// 無効のままになる。静的な可視区間だけで下位のカットを除くと、そのフレームで二重像になる。
test('resolves cuts using frozen camera visibility at the frame reference time', () => {
	const frozen = { ...cameraLayer('frozen', 100, 100), forceDisableMotionBlur: true };
	const lower = cameraLayer('lower', 102, 48);
	const cuts = new TimelineCameraCuts([frozen, lower]);
	assert.deepEqual(cuts.getBoundaries(99), [102, 150]);
	assert.deepEqual(cuts.getBoundaries(110), []);
	assert.deepEqual(cuts.getBoundaries(200), [102, 150]);
	const higher = cameraLayer('higher', 120, 10);
	assert.deepEqual(new TimelineCameraCuts([higher, frozen, lower]).getBoundaries(110), [120, 130]);
	const scene = { id: 'scene', layers: [frozen, lower, { layerType: 'image', clips: [{ startMs: 0, durationMs: 1000 }] }] };
	const boundaries = getTimelineMotionBlurBoundaries([scene], scene.id);
	const cameras = getTimelineMotionBlurCameraCuts([scene], scene.id);
	const settings = { enabled: true, shutterAngle: 360, samples: 8 };
	assert.ok(getTimelineSampleTimes(99, 60, settings, boundaries, [], cameras).every(time => time < 102));
	assert.deepEqual(getTimelineSampleTimes(110, 60, settings, boundaries, [], cameras), getTimelineSampleTimes(110, 60, settings, boundaries));
});

// 【同じ子Sceneのカメラを、配置の内容オフセットと固定状態ごとに扱う】
// 共有するのは選択計画だけで、どの固定カメラが有効かは配置ごとのScene時刻で決まる。
// 非表示・ブラー無効のScene配置は、他の映像の露光へカットを持ち込まない。
test('maps child camera cuts through placement offsets and skips frozen or disabled scenes', () => {
	const child = { id: 'child', layers: [
		{ ...cameraLayer('frozen', 100, 100), forceDisableMotionBlur: true }, cameraLayer('lower', 102, 48),
	] };
	const placement = (id, contentOffsetMs, extra = {}) => ({ id, layerType: 'scene', clips: [{ startMs: 0, durationMs: 1000, sceneId: child.id, contentOffsetMs }], ...extra });
	const root = { id: 'root', layers: [placement('first', 0), placement('second', 50.25),
		placement('fixed', 80, { forceDisableMotionBlur: true }), placement('hidden', 80, { isDisabled: true })] };
	const scenes = [root, child];
	const cameras = getTimelineMotionBlurCameraCuts(scenes, root.id);
	assert.equal(cameras.length, 2);
	const settings = { enabled: true, shutterAngle: 360, samples: 8 };
	const boundaries = getTimelineMotionBlurBoundaries(scenes, root.id);
	assert.ok(getTimelineSampleTimes(49, 60, settings, boundaries, [], cameras).every(time => time < 51.75));
	assert.deepEqual(getTimelineSampleTimes(105, 60, settings, boundaries, [], cameras), getTimelineSampleTimes(105, 60, settings, boundaries));
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

// 【カメラにも通常レイヤーと共通の式スコープを渡す】
// 時刻だけを手書きしたスコープでは、共通の環境変数追加時にカメラだけ未定義になる。
// レイヤー用の検証変数と書き出し状態が、式と環境変数Bindingの両方から読めることを保証する。
test('uses the shared layer variables for camera expressions and environment bindings', () => {
	const camera = { automationGraphs: [], paramValues: {
		position: { inputSource: 'expression', expression: '[TIME, TIME_MS]' },
		z: { inputSource: 'envVariable', variable: 'TEST_SAME_NAME' },
		fieldOfView: { inputSource: 'expression', expression: 'if TEST_ONLY_LAYER && IS_EXPORT { 60 } else { 45 }' },
	} };
	assert.deepEqual(evaluator.evaluate(camera, 250, true), { position: [0.25, 250], z: 2, fieldOfView: 60 });
	assert.equal(evaluator.evaluate(camera, 250, false).fieldOfView, 45);
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
	near(parent([outer], { ...settings, coordinateSpace: 'screen' }), TIMELINE_IDENTITY);
	near(parent([{ ...outer, compositingMode: 'flat' }], { ...settings, coordinateSpace: 'screen' }), projectTimelineMatrix([1, 0, 0, 1, 0.3, 0.5], 1, camera));
});
