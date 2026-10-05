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
		export { createShapeTimelineLayer } from './src/utility/shape-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'shape-layer-test', setup(build) {
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
const { COMMAND_DEFS, UndoRedo, createShapeTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, encodeProjectFile, decodeProjectFile } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

function fixture(t, type = 'rectangle') {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	const initial = createShapeTimelineLayer(type, 100.4);
	history.commit('addTimelineLayer', { sceneId: scene.id, layer: initial });
	const target = { sceneId: scene.id, layerId: initial.id, target: 'shape' };
	return { scene, state, history, changes, target, initial,
		get layer() { return scene.layers.find(layer => layer.id === initial.id); },
		edit(key, edit, mergeKey) { history.commit('editTimelineLayerParam', { ...target, paramPath: [key], edit }, mergeKey); },
	};
}

// 【シェイプの連続編集を一つのUndoにまとめ、形状だけを差分同期する】
// 将来の直接編集も同じCommandを使う。位置を変えても合成設定の位置を上書きせず、
// Undo/Redoと通常編集が同じ変更通知を出すことを保証する。
test('merges shape edits with undo and redo while preserving compositing settings', t => {
	const f = fixture(t);
	assert.equal(f.layer.clips[0].startMs, 100);
	assert.equal(f.layer.clips[0].durationMs, 5000);
	const compositing = structuredClone(f.layer.compositingParamValues);
	f.edit('position', { kind: 'literal', value: [0.2, -0.4] }, 'drag');
	f.edit('position', { kind: 'literal', value: [0.4, -0.6] }, 'drag');
	assert.equal(f.history.undoStack.value.length, 2);
	assert.deepEqual(f.layer.shape.paramValues.position, literal([0.4, -0.6]));
	f.history.undo();
	assert.deepEqual(f.layer.shape.paramValues.position, literal([0, 0]));
	f.history.redo();
	assert.deepEqual(f.layer.shape.paramValues.position, literal([0.4, -0.6]));
	assert.deepEqual(f.layer.compositingParamValues, compositing);
	for (const change of f.changes.slice(1)) assert.deepEqual(change, [{ type: 'layer', sceneId: 'scene', layerId: f.layer.id,
		changes: [{ type: 'parameter', target: 'shape', kind: 'value' }] }]);
	f.edit('position', { kind: 'reset' });
	assert.deepEqual(f.layer.shape.paramValues.position, literal([0, 0]));
	f.history.undo();
	assert.deepEqual(f.layer.shape.paramValues.position, literal([0.4, -0.6]));
	assert.deepEqual(f.initial.shape.paramValues.position, literal([0, 0]));
});

// 【シェイプと合成設定のキーを別の対象として編集し、空レイヤーでもキーを保持する】
// 両者にPositionが存在するため、対象の取り違えを検出する。最後のクリップを削除しても
// アニメーションはレイヤー所有のままで、Undoでクリップと同じIDを復元する。
test('edits scene-time shape keyframes independently of composition and clip lifetime', t => {
	const f = fixture(t, 'ellipse');
	f.edit('size', { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const binding = f.layer.shape.paramValues.size;
	const keyed = { ...binding, keyframesTimeline: { ...binding.keyframesTimeline, keyframes: [
		{ id: 'size-key', x: 150.6, value: [0.4, 0.2], interpolation: { type: 'linear' } },
	] } };
	f.edit('size', { kind: 'keyframesTimelineInline', value: keyed });
	assert.equal(f.layer.shape.paramValues.size.keyframesTimeline.keyframes[0].x, 151);
	f.history.commit('editTimelineLayerParam', { ...f.target, target: 'compositing', paramPath: ['position'], edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(row => row.label), ['Compositing / Position', 'Shape / Size']);
	f.history.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...f.target, paramPath: ['size'], keyframeId: 'size-key', x: 400 }] });
	assert.equal(f.layer.shape.paramValues.size.keyframesTimeline.keyframes[0].x, 400);
	f.history.undo();
	assert.equal(f.layer.shape.paramValues.size.keyframesTimeline.keyframes[0].x, 151);
	const clip = structuredClone(f.layer.clips[0]);
	f.history.commit('removeTimelineClips', { sceneId: 'scene', clips: [{ layerId: f.layer.id, clipId: clip.id }] });
	assert.deepEqual(f.layer.clips, []);
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 2);
	f.history.undo();
	assert.deepEqual(f.layer.clips, [clip]);
	assert.equal(resolveLayerParameter(f.state, f.layer, 'shape', ['size']).def.dataType.kind, 'vector');
});

// 【式・キー・塗りと輪郭を保存し、レイヤー複製後も元の形状を変更しない】
// シェイプをレンダラー内だけの状態にすると保存とコピーで消えるため、実際の保存形式と
// レイヤー追加・貼り付けのCommandを通して確認する。
test('round-trips animated shapes and duplicates their independent settings', async t => {
	const f = fixture(t);
	f.edit('cornerRadius', { kind: 'expression', value: 'TIME * 0.02' });
	f.edit('strokeEnabled', { kind: 'literal', value: true });
	f.edit('strokeAlignment', { kind: 'literal', value: 'outside' });
	f.edit('fillColor', { kind: 'literal', value: [0.2, 0.4, 0.8, 0.5] });
	f.edit('strokeStart', { kind: 'literal', value: 0.75 });
	f.edit('strokeProgress', { kind: 'expression', value: 'TIME / 5' });
	f.edit('rotation', { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const rotation = f.layer.shape.paramValues.rotation;
	f.edit('rotation', { kind: 'keyframesTimelineInline', value: { ...rotation,
		keyframesTimeline: { ...rotation.keyframesTimeline, keyframes: [
			{ id: 'rotation-key', x: 500, value: 0.25, interpolation: { type: 'linear' } },
		] },
	} });
	const duplicate = structuredClone(f.layer);
	duplicate.id = 'duplicate';
	duplicate.clips[0].id = 'duplicate-clip';
	f.history.commit('pasteTimelineLayer', { sceneId: 'scene', layer: duplicate, sourceLayerId: f.layer.id });
	const pasted = f.scene.layers.find(layer => layer.id === 'duplicate');
	pasted.shape.paramValues.fillColor.value[0] = 1;
	assert.equal(f.layer.shape.paramValues.fillColor.value[0], 0.2);
	const project = { id: 'project', gsVersion: '2.0.0-alpha', name: 'Shapes', description: '', author: '',
		resolution: { width: 1920, height: 1080 }, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		assets: [], players: [], visualModules: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	const invalidProject = structuredClone(project);
	invalidProject.timelineScenes[0].layers[0].shape.paramValues.fillColor = { inputSource: 'layerInput' };
	const invalidFile = await encodeProjectFile(invalidProject);
	assert.throws(() => decodeProjectFile(invalidFile), /Layer input/);
	f.history.undo();
	assert.equal(f.scene.layers.length, 1);
	f.history.redo();
	assert.equal(f.scene.layers[0].id, 'duplicate');
});

// 【シェイプにノード・下層画像・音声のBindingを混入させない】
// UIで候補を隠すだけではCommandや保存データから不正な方式を持ち込めるため、
// 編集・追加・読込の境界で拒否し、失敗した編集では元の状態を保つ。
test('rejects unsupported shape bindings and unknown geometry without committing changes', t => {
	const f = fixture(t);
	const before = structuredClone(f.layer);
	for (const inputSource of ['node', 'layerInput', 'lowerLayerAudio', 'layerAudio']) {
		assert.throws(() => f.edit('fillColor', { kind: 'inputSource', inputSource }));
		assert.deepEqual(f.layer, before);
	}
	const invalid = createShapeTimelineLayer('ellipse', 0);
	invalid.shape.paramValues.size = { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' };
	assert.throws(() => f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: invalid }), /Layer input/);
	invalid.shape.type = 'future-shape';
	assert.throws(() => f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: invalid }), /Unknown shape type/);
	assert.equal(f.scene.layers.length, 1);
});

// 【起点と進行率も通常のパラメータと同じ履歴・キー対象にする】
// 専用の描画だけで値を持つとUndoやキー選択で復元できないため、編集経路を確認する。
test('edits and resets stroke progress and start through ordinary shape commands', t => {
	const f = fixture(t);
	f.edit('strokeStart', { kind: 'literal', value: 0.5 });
	f.edit('strokeProgress', { kind: 'literal', value: 0.25 });
	f.history.undo();
	assert.deepEqual(f.layer.shape.paramValues.strokeProgress, literal(1));
	assert.deepEqual(f.layer.shape.paramValues.strokeStart, literal(0.5));
	f.history.redo();
	assert.deepEqual(f.layer.shape.paramValues.strokeProgress, literal(0.25));
	for (const key of ['strokeStart', 'strokeProgress']) f.edit(key, { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(row => row.label).sort(), ['Shape / Stroke progress', 'Shape / Stroke start']);
	f.edit('strokeProgress', { kind: 'reset' });
	f.edit('strokeStart', { kind: 'reset' });
	assert.deepEqual(f.layer.shape.paramValues.strokeProgress, literal(1));
	assert.deepEqual(f.layer.shape.paramValues.strokeStart, literal(0));
});
