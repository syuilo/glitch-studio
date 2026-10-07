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
		export { createTextTimelineLayer } from './src/utility/text-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'text-layer-test', setup(build) {
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
const { COMMAND_DEFS, UndoRedo, createTextTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, encodeProjectFile, decodeProjectFile } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

function fixture(t) {
	t.mock.method(console, 'log', () => {});
	const scene = { id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] };
	const state = { timelineScenes: { value: [scene] }, visualModules: { value: [] }, assets: { value: [] } };
	const history = new UndoRedo(state, COMMAND_DEFS);
	const changes = [];
	history.onChange(value => changes.push(value));
	const initial = createTextTimelineLayer(100.4);
	history.commit('addTimelineLayer', { sceneId: scene.id, layer: initial });
	const target = { sceneId: scene.id, layerId: initial.id, target: 'text' };
	return { scene, state, history, changes, target, initial,
		get layer() { return scene.layers.find(layer => layer.id === initial.id); },
		edit(key, edit, mergeKey) { history.commit('editTimelineLayerParam', { ...target, paramPath: [key], edit }, mergeKey); },
	};
}

// 【Textの連続編集とリセットをUndo/Redo・差分同期へ通す】
// 本文だけの変更でも保存用Bindingを使い、装飾と合成設定のPositionを混同しない。
test('merges text edits and resets with independent defaults and compositing', t => {
	const f = fixture(t);
	assert.equal(f.layer.clips[0].startMs, 100);
	assert.equal(f.layer.clips[0].durationMs, 5000);
	const compositing = structuredClone(f.layer.compositingParamValues);
	f.edit('text', { kind: 'literal', value: 'Hello' }, 'typing');
	f.edit('text', { kind: 'literal', value: 'Hello, timeline!' }, 'typing');
	assert.equal(f.history.undoStack.value.length, 2);
	f.history.undo();
	assert.deepEqual(f.layer.textParamValues.text, literal('Hello, world!'));
	f.history.redo();
	assert.deepEqual(f.layer.textParamValues.text, literal('Hello, timeline!'));
	for (const change of f.changes.slice(1)) assert.deepEqual(change, [{ type: 'layer', sceneId: 'scene', layerId: f.layer.id,
		changes: [{ type: 'parameter', target: 'text', kind: 'value' }] }]);
	f.edit('position', { kind: 'literal', value: [0.3, 0.4] });
	assert.deepEqual(f.layer.compositingParamValues, compositing);
	f.edit('text', { kind: 'reset' });
	assert.deepEqual(f.layer.textParamValues.text, literal('Hello, world!'));
	f.history.undo();
	assert.deepEqual(f.layer.textParamValues.text, literal('Hello, timeline!'));
	assert.deepEqual(f.initial.textParamValues.text, literal('Hello, world!'));
});

// 【Textのキーはクリップを削除しても残り、専用レーンで編集できる】
// 本文・装飾はレイヤー所有で、合成設定と同じキー対象へ混入しないことを保証する。
test('keeps scene-time text keyframes when the last clip is removed', t => {
	const f = fixture(t);
	f.edit('size', { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const binding = f.layer.textParamValues.size;
	f.edit('size', { kind: 'keyframesTimelineInline', value: { ...binding, keyframesTimeline: { ...binding.keyframesTimeline, keyframes: [
		{ id: 'size-key', x: 150.6, value: 0.2, interpolation: { type: 'linear' } },
	] } } });
	assert.equal(f.layer.textParamValues.size.keyframesTimeline.keyframes[0].x, 151);
	assert.equal(getLayerKeyframeParameters(f.state, f.layer)[0].target, 'text');
	f.history.commit('moveTimelineKeyframes', { sceneId: 'scene', positions: [{ ...f.target, paramPath: ['size'], keyframeId: 'size-key', x: 400 }] });
	assert.equal(f.layer.textParamValues.size.keyframesTimeline.keyframes[0].x, 400);
	f.history.undo();
	assert.equal(f.layer.textParamValues.size.keyframesTimeline.keyframes[0].x, 151);
	const clip = structuredClone(f.layer.clips[0]);
	f.history.commit('removeTimelineClips', { sceneId: 'scene', clips: [{ layerId: f.layer.id, clipId: clip.id }] });
	assert.equal(f.layer.clips.length, 0);
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 1);
	f.history.undo();
	assert.deepEqual(f.layer.clips, [clip]);
	assert.equal(resolveLayerParameter(f.state, f.layer, 'text', ['font']).def.dataType.kind, 'fontAssetReference');
});

// 【本文・フォント・影・式を保存し、複製と読込後も保持する】
// 描画だけの状態にするとプロジェクトの保存やコピーで失われるため、実際の保存形式を往復する。
test('round-trips and duplicates text layers without sharing parameter values', async t => {
	const f = fixture(t);
	f.edit('text', { kind: 'literal', value: '日本語\nText' });
	f.edit('font', { kind: 'literal', value: 'font-asset' });
	f.edit('shadowEnabled', { kind: 'literal', value: true });
	f.edit('shadowColor', { kind: 'literal', value: [0.2, 0.4, 0.8, 0.5] });
	f.edit('size', { kind: 'expression', value: 'TIME * 0.02' });
	const duplicate = structuredClone(f.layer);
	duplicate.id = 'duplicate';
	duplicate.clips[0].id = 'duplicate-clip';
	f.history.commit('pasteTimelineLayer', { sceneId: 'scene', layer: duplicate, sourceLayerId: f.layer.id });
	const pasted = f.scene.layers.find(layer => layer.id === 'duplicate');
	pasted.textParamValues.shadowColor.value[0] = 1;
	assert.equal(f.layer.textParamValues.shadowColor.value[0], 0.2);
	const project = { id: 'project', gsVersion: '2.0.0-alpha', name: 'Text', description: '', author: '',
		resolution: { width: 1920, height: 1080 }, timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 },
		assets: [], generatedSpeech: [], players: [], visualModules: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	const invalid = structuredClone(project);
	invalid.timelineScenes[0].layers[0].textParamValues.color = { inputSource: 'layerInput' };
	const invalidFile = await encodeProjectFile(invalid);
	assert.throws(() => decodeProjectFile(invalidFile), /Layer input/);
	f.history.undo();
	assert.equal(f.scene.layers.length, 1);
	f.history.redo();
	assert.equal(f.scene.layers[0].id, 'duplicate');
});

// 【Textの値入力に画像・音声・ノード接続を混入させない】
// UIだけでなくCommandの受け入れ境界でも検証し、失敗した編集を履歴へ残さない。
test('rejects unsupported bindings without committing changes', t => {
	const f = fixture(t);
	const before = structuredClone(f.layer);
	for (const inputSource of ['node', 'layerInput', 'lowerLayerAudio', 'layerAudio']) {
		assert.throws(() => f.edit('color', { kind: 'inputSource', inputSource }));
		assert.deepEqual(f.layer, before);
	}
	const invalid = createTextTimelineLayer(0);
	invalid.textParamValues.color = { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'clamp', filterMode: 'linear' };
	assert.throws(() => f.history.commit('addTimelineLayer', { sceneId: 'scene', layer: invalid }), /Layer input/);
});

