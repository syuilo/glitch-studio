import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
		export { createTransformTimelineLayer } from './src/utility/transform-timeline-layer.ts';
		export { duplicateTimelineLayers } from './src/utility/timeline-container.ts';
		export { findTimelineLayer } from '@gs/subsystems_timeline_shared/layer-tree.ts';
		export { getRendererLayerState, applyRendererProjectChanges } from '@gs/glitch-studio_shared/project/renderer-state.ts';
		export { createCameraTimelineLayer } from './src/utility/camera-timeline-layer.ts';
		export { getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { copyTimelineKeyframes, prepareTimelineKeyframePaste } from './src/utility/timeline-keyframe-clipboard.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'camera-layer-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			contents: path === 'effects' ? 'export const effectDefinitions = {};'
				: 'export const preferences = { s: { forceTypeSafety: true } };', loader: 'ts',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, UndoRedo, createCameraTimelineLayer, createTransformTimelineLayer, duplicateTimelineLayers, findTimelineLayer, getRendererLayerState, applyRendererProjectChanges, getLayerKeyframeParameters, copyTimelineKeyframes, prepareTimelineKeyframePaste, encodeProjectFile, decodeProjectFile } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	const initial = createCameraTimelineLayer(100.4);
	history.commit('addTimelineLayer', { sceneId: scene.id, layer: initial });
	const target = { sceneId: scene.id, layerId: initial.id, target: 'camera' };
	return { scene, state, history, changes, target, initial,
		get layer() { return scene.layers.find(layer => layer.id === initial.id); },
		edit(key, edit, mergeKey) { history.commit('editTimelineLayerParam', { ...target, paramPath: [key], edit }, mergeKey); },
	};
}

// 【カメラのキーを通常のレーンで移動・コピーし、Undo/Redoで復元する】
// 設定ダイアログだけでキーを編集できても、タイムラインの選択・ドラッグ・貼り付けから
// 到達できなければ今回の目的を満たさない。共通Commandとレーン探索を通して確認する。
test('edits camera keyframes through timeline lanes and clipboard with undo and redo', t => {
	const f = fixture(t);
	assert.equal(f.layer.clips[0].startMs, 100);
	assert.equal('compositingParamValues' in f.layer, false);
	f.edit('position', { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const binding = f.layer.cameraParamValues.position;
	f.edit('position', { kind: 'keyframesTimelineInline', value: { ...binding,
		keyframesTimeline: { ...binding.keyframesTimeline, keyframes: [{ id: 'move', x: 150.6, value: [0.4, 0.2], interpolation: { type: 'linear' } }] },
	} });
	const keys = () => f.layer.cameraParamValues.position.keyframesTimeline.keyframes;
	assert.equal(keys()[0].x, 151);
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(lane => [lane.target, lane.paramPath]), [['camera', ['position']]]);
	const point = { ...f.target, paramPath: ['position'], keyframeId: 'move' };
	f.history.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...point, x: 400 }] });
	assert.equal(keys()[0].x, 400);
	f.history.undo();
	assert.equal(keys()[0].x, 151);
	f.history.redo();
	assert.equal(keys()[0].x, 400);
	const copied = copyTimelineKeyframes(f.state, f.scene, [point]);
	const pasted = prepareTimelineKeyframePaste(f.state, f.scene, copied, 800);
	assert.ok(pasted);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes: pasted });
	assert.deepEqual(keys().map(key => key.x), [400, 800]);
	f.history.undo();
	assert.equal(keys().length, 1);
	f.history.redo();
	assert.equal(keys()[1].id, pasted[0].keyframe.id);
	const clip = structuredClone(f.layer.clips[0]);
	f.history.commit('removeTimelineClips', { sceneId: 'scene', clips: [{ layerId: f.layer.id, clipId: clip.id }] });
	assert.deepEqual(f.layer.clips, []);
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 1);
	f.history.undo();
	assert.deepEqual(f.layer.clips, [clip]);
});

// 【カメラのグループ化・子への移動・子の位置への貼り付けを原子的に拒否する】
// UI上のドロップ制限だけではショートカットやCommand経由で不正なSceneを作れてしまう。
// 拒否後に元のツリーとUndo履歴が維持されることも確認する。
test('rejects camera nesting through group, move, and paste commands', t => {
	const f = fixture(t);
	const group = { id: 'group', name: 'Group', layerType: 'group', layers: [], isDisabled: false,
		forceDisableMotionBlur: false, automationGraphs: [], compositingParamValues: {}, audioParamValues: {} };
	f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: group });
	const before = structuredClone(f.scene.layers);
	const undoCount = f.history.undoStack.value.length;
	assert.throws(() => f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: [f.layer.id], group: { ...group, id: 'new-group' } }), /inside a Group/);
	assert.throws(() => f.history.commit('moveTimelineLayer', { sceneId: 'scene', layerId: f.layer.id, parentId: 'group', beforeId: null }), /inside a Group/);
	assert.deepEqual(f.scene.layers, before);
	assert.equal(f.history.undoStack.value.length, undoCount);
	const child = { id: 'child', name: 'Child', layerType: 'audio', isDisabled: false, automationGraphs: [], clips: [], audioParamValues: {} };
	f.scene.layers.find(layer => layer.id === 'group').layers.push(child);
	assert.throws(() => f.history.commit('pasteTimelineLayer', { sceneId: 'scene', sourceLayerId: 'child', layer: { ...f.layer, id: 'copy' } }), /inside a Group/);
	assert.equal(f.scene.layers.find(layer => layer.id === 'group').layers.length, 1);
});

// 【カメラの式・キー・クリップを保存し、複製後は独立して編集できる】
// カメラがScene設定に残っていたり、複製でBindingを共有すると、切り替え先の編集が元の視点を変えてしまう。
test('round-trips camera layers and duplicates independent camera settings', async t => {
	const f = fixture(t);
	f.edit('z', { kind: 'expression', value: '3 + TIME' });
	f.edit('fieldOfView', { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const copy = structuredClone(f.layer);
	copy.id = 'copy';
	copy.clips[0].id = 'copy-clip';
	f.history.commit('pasteTimelineLayer', { sceneId: 'scene', sourceLayerId: f.layer.id, layer: copy });
	f.history.commit('editTimelineLayerParam', { ...f.target, layerId: copy.id, paramPath: ['z'], edit: { kind: 'literal', value: 5 } });
	assert.equal(f.layer.cameraParamValues.z.expression, '3 + TIME');
	const project = { id: 'project', gsVersion: '2.0.0-alpha', name: 'Cameras', description: '', author: '',
		resolution: { width: 1920, height: 1080 }, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
});

// 【Transformにカメラと映像をまとめ、親のキーと子のクリップを一括移動する】
// 新しい階層が表示専用で終わらず、通常のキー編集・コピー・移動・解除・Undoに参加することを確認する。
test('wraps cameras and images in Transform and edits their shared timeline with undo', t => {
	const f = fixture(t);
	const cameraId = f.layer.id;
	const image = { id: 'image', name: 'Image', layerType: 'image', isDisabled: false, forceDisableMotionBlur: false, automationGraphs: [], compositingParamValues: {}, clips: [] };
	f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: image });
	const transform = createTransformTimelineLayer();
	f.history.commit('transformTimelineLayers', { sceneId: 'scene', layerIds: [image.id, cameraId], transform });
	const parent = () => findTimelineLayer(f.scene.layers, transform.id);
	assert.deepEqual(parent().layers.map(layer => layer.id), [image.id, cameraId]);
	assert.equal('clips' in parent(), false);
	assert.equal('compositingParamValues' in parent(), false);
	const target = { sceneId: 'scene', layerId: transform.id, target: 'transform', paramPath: ['z'] };
	f.history.commit('editTimelineLayerParam', { ...target, edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	const binding = parent().transformParamValues.z;
	f.history.commit('editTimelineLayerParam', { ...target, edit: { kind: 'keyframesTimelineInline', value: { ...binding,
		keyframesTimeline: { ...binding.keyframesTimeline, keyframes: [{ id: 'parent-key', x: 200, value: 0.5, interpolation: { type: 'linear' } }] } } } });
	assert.deepEqual(getLayerKeyframeParameters(f.state, parent()).map(lane => lane.target), ['transform']);
	const point = { ...target, keyframeId: 'parent-key' };
	const copied = copyTimelineKeyframes(f.state, f.scene, [point]);
	const pasted = prepareTimelineKeyframePaste(f.state, f.scene, copied, 600);
	f.history.commit('pasteTimelineKeyframes', { sceneId: 'scene', keyframes: pasted });
	f.history.commit('moveTimelineContainer', { sceneId: 'scene', layerId: transform.id, deltaMs: 300 });
	assert.equal(findTimelineLayer(f.scene.layers, cameraId).clips[0].startMs, 400);
	assert.deepEqual(parent().transformParamValues.z.keyframesTimeline.keyframes.map(key => key.x), [500, 900]);
	f.history.undo();
	assert.equal(findTimelineLayer(f.scene.layers, cameraId).clips[0].startMs, 100);
	f.history.redo();
	f.history.commit('unwrapTimelineLayer', { sceneId: 'scene', layerId: transform.id });
	assert.deepEqual(f.scene.layers.map(layer => layer.id), [image.id, cameraId]);
	f.history.undo();
	assert.equal(parent().layers.length, 2);
});

// 【カメラを含むTransformのGroupへの移動・貼り付け・グループ化を原子的に拒否する】
// 直接の子だけを見ると、Transformを使ってカメラの配置制限をすり抜けてしまう。
test('rejects cameras hidden under Transform when editing group boundaries', t => {
	const f = fixture(t);
	const cameraId = f.layer.id;
	const transform = createTransformTimelineLayer();
	f.history.commit('transformTimelineLayers', { sceneId: 'scene', layerIds: [cameraId], transform });
	const group = { id: 'group', name: 'Group', layerType: 'group', layers: [createTransformTimelineLayer()], isDisabled: false,
		forceDisableMotionBlur: false, automationGraphs: [], compositingParamValues: {}, audioParamValues: {} };
	f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: group });
	const before = structuredClone(f.scene.layers);
	const count = f.history.undoStack.value.length;
	assert.throws(() => f.history.commit('moveTimelineLayer', { sceneId: 'scene', layerId: transform.id, parentId: group.layers[0].id, beforeId: null }), /inside a Group/);
	assert.throws(() => f.history.commit('groupTimelineLayers', { sceneId: 'scene', layerIds: [transform.id], group: { ...group, id: 'other', layers: [] } }), /inside a Group/);
	const copy = duplicateTimelineLayers([findTimelineLayer(f.scene.layers, transform.id)])[0];
	assert.throws(() => f.history.commit('pasteTimelineLayer', { sceneId: 'scene', sourceLayerId: group.layers[0].id, layer: copy }), /inside a Group/);
	assert.deepEqual(f.scene.layers, before);
	assert.equal(f.history.undoStack.value.length, count);
	// Transform同士の移動は認め、同じカメラID・クリップ・キーを保つ。
	const outer = createTransformTimelineLayer();
	f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: outer });
	f.history.commit('moveTimelineLayer', { sceneId: 'scene', layerId: transform.id, parentId: outer.id, beforeId: null });
	assert.equal(findTimelineLayer(f.scene.layers, outer.id).layers[0].layers[0].id, cameraId);
});

// 【Transformの設定差分は子を維持し、複製と保存で木全体を保持する】
// Workerへ子なしの設定を送ったときに配下を消したり、複製で元のBindingを共有してはいけない。
test('preserves Transform descendants through renderer patches, duplication and project files', async t => {
	const f = fixture(t);
	const transform = createTransformTimelineLayer();
	f.history.commit('transformTimelineLayers', { sceneId: 'scene', layerIds: [f.layer.id], transform });
	const original = f.scene.layers[0];
	const renderer = { timelineScenes: [structuredClone(f.scene)], visualModules: [] };
	const settings = getRendererLayerState(original);
	assert.equal('layers' in settings, false);
	settings.transformParamValues = { ...settings.transformParamValues, position: { inputSource: 'expression', expression: '[TIME, 0]' } };
	const patched = applyRendererProjectChanges(renderer, [{ type: 'layer', sceneId: 'scene', layerId: original.id, layer: settings, changes: [{ type: 'parameter', target: 'transform', kind: 'value' }] }]);
	assert.equal(patched.timelineScenes[0].layers[0].layers, renderer.timelineScenes[0].layers[0].layers);
	const [copy] = duplicateTimelineLayers([original]);
	assert.notEqual(copy.id, original.id);
	assert.notEqual(copy.layers[0].id, original.layers[0].id);
	assert.notEqual(copy.layers[0].clips[0].id, original.layers[0].clips[0].id);
	copy.transformParamValues.z.value = 5;
	assert.equal(original.transformParamValues.z.value, 0);
	const project = { id: 'project', gsVersion: '2.0.0-alpha', name: 'Transforms', description: '', author: '',
		resolution: { width: 1920, height: 1080 }, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: patched.timelineScenes };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
});

