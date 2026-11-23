import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const directory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: directory, bundle: true, platform: 'node', format: 'cjs', write: false,
	stdin: { resolveDir: directory, loader: 'ts', contents: `
		export { getTimelineParameterEditBinding } from './src/commands/timeline-parameter-api.ts';
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createTimelineCommandDefinitions } from './src/commands/timeline-api.ts';
		export { UndoRedo } from './src/utility/undo-redo.ts';
	` },
	plugins: [{ name: 'timeline-command-effects', setup(build) {
		build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ loader: 'ts', contents: 'export const nativeEffectDefinitions = {};' }));
	} }],
});
const loaded = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), loaded, loaded.exports);
const { COMMAND_DEFS, createTimelineCommandDefinitions, UndoRedo } = loaded.exports;

function fixture(services) {
	const state = { timelineScenes: { value: [] }, nodesEffects: { value: [] }, assets: { value: [] } };
	const definitions = { ...COMMAND_DEFS, ...createTimelineCommandDefinitions(services) };
	return { state, definitions, manager: new UndoRedo(state, definitions) };
}

// 【Scene作成・複製の名前を実行時に検証して保存データの型を守る】
// スクリプトの入力はTypeScriptを通らないため、既定値で隠れない非文字列の入力を拒否する。
// 複製だけ検証を抜けたり、準備失敗で既存SceneとRedoを変更したりしないことを確認する。
test('rejects invalid Scene names before creation and duplication', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', { name: 'Existing' });
	manager.commit('createTimelineScene', { name: 'Redo target' });
	manager.undo();
	const before = structuredClone(state.timelineScenes.value);
	for (const name of [123, false, {}, []]) {
		assert.throws(() => manager.commit('createTimelineScene', { name }), /input: name:/);
		assert.throws(() => manager.commit('duplicateTimelineScene', { ...scene, name }), /input: name:/);
		assert.deepEqual(state.timelineScenes.value, before);
		assert.equal(manager.redoStack.value.length, 1);
	}
	manager.redo();
	assert.equal(state.timelineScenes.value.length, 2);
});

// 【Timelineの文字列・真偽値・座標系を未検証のスクリプト入力で破損させない】
// 文字列のfalseなどをそのまま保存すると、描画とUIで真偽の解釈が食い違う。
// 各操作は誤った型を適用前に拒否し、名前変更も同じ境界で保護する。
test('rejects invalid basic Timeline settings without changing state or redo', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'text' } });
	manager.commit('setTimelineLayerName', { ...layer, name: 'Renamed' });
	manager.undo();
	const before = structuredClone(state.timelineScenes.value);
	for (const [command, input] of [
		['setTimelineSceneName', { ...scene, name: 123 }],
		['setTimelineLayerName', { ...layer, name: {} }],
		['setTimelineLayerDisabled', { ...layer, isDisabled: 'false' }],
		['setTimelineLayerSolo', { ...layer, isSolo: 1 }],
		['setTimelineLayerCoordinateSpace', { ...layer, coordinateSpace: 'unknown' }],
		['setTimelineLayerMotionBlurDisabled', { ...layer, forceDisableMotionBlur: 'false' }],
	]) {
		assert.throws(() => manager.commit(command, input), /input: (name|isDisabled|isSolo|coordinateSpace|forceDisableMotionBlur):/);
		assert.deepEqual(state.timelineScenes.value, before);
		assert.equal(manager.redoStack.value.length, 1);
	}
	manager.redo();
	assert.equal(state.timelineScenes.value[0].layers[0].name, 'Renamed');
});

// 【レイヤー識別色はUI用RGBAとして検証し、nullによる既定色への復帰を維持する】
// 作品の色にはHDRを許すが、レイヤーラベルは0〜1の4成分だけを受け取る。
// 配列長・型・非有限値・範囲外の値は適用せず、正しい色はUndoで復元できる。
test('validates Timeline label colors while accepting null and finite RGBA', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'text' } });
	for (const color of ['red', [], [1, 0, 0], [1, 0, 0, 1, 1], [NaN, 0, 0, 1], [Infinity, 0, 0, 1], [-0.1, 0, 0, 1], [2, 0, 0, 1], ['1', 0, 0, 1]]) {
		assert.throws(() => manager.commit('setTimelineLayerColor', { ...layer, color }), /input: color/);
		assert.equal(state.timelineScenes.value[0].layers[0].color, null);
	}
	manager.commit('setTimelineLayerColor', { ...layer, color: [1, 0.2, 0.3, 1] });
	manager.commit('setTimelineLayerColor', { ...layer, color: null });
	assert.equal(state.timelineScenes.value[0].layers[0].color, null);
	manager.undo();
	assert.deepEqual(state.timelineScenes.value[0].layers[0].color, [1, 0.2, 0.3, 1]);
});

// 【動画クリップの出力フラグは真偽値だけを保存する】
// ダイアログやスクリプトの文字列を暗黙に真と解釈すると、音声・映像の出力が意図せず変わる。
// 素材差し替えに付随する音声設定も同じ規則を適用する。
test('rejects invalid video and audio enabled flags before changing a clip', () => {
	const { state, manager } = fixture({ inspectMedia: () => ({ durationMs: 1000, audioAvailable: true, audioError: null }) });
	const scene = manager.commit('createTimelineScene', {});
	state.assets.value.push({ id: 'video', fileDataType: 'video/mp4', fileData: new Blob() });
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'video' }, clips: [{ assetId: 'video', startMs: 0, durationMs: 500, sourceInMs: 0, sourceOutMs: 500, playbackRate: 1, loop: false, audioEnabled: true, videoEnabled: true }] });
	const target = { ...layer, clipId: state.timelineScenes.value[0].layers[0].clips[0].id };
	const before = structuredClone(state.timelineScenes.value);
	assert.throws(() => manager.commit('setTimelineVideoClipVideoEnabled', { ...target, videoEnabled: 'false' }), /input: videoEnabled:/);
	assert.throws(() => manager.commit('setTimelineVideoClipAudioEnabled', { ...target, audioEnabled: 0 }), /input: audioEnabled:/);
	assert.throws(() => manager.commit('setTimelineClipSource', { ...target, assetId: 'video', audioEnabled: 'true' }), /input: audioEnabled:/);
	assert.deepEqual(state.timelineScenes.value, before);
});

// 【生成用レシピから採番し、準備段階と呼び出し元の値を編集しない】
// スクリプト側に保存形式の全フィールドやIDを要求せず、Redoは一度確定した生成物だけを復元する。
// 入力の編集や作成後の別操作が、履歴の保存値を変更しないことも確認する。
test('prepares recipe creation without live mutations and reuses detached generated identities', () => {
	const { state, definitions, manager } = fixture();
	const scene = manager.commit('createTimelineScene', { name: 'Scene' });
	const input = { sceneId: scene.sceneId, layer: { layerType: 'text', name: 'Caption' }, clips: [{ startMs: 100, durationMs: 900, contentOffsetMs: 0 }] };
	const before = structuredClone(input);
	const prepared = definitions.createTimelineLayer.prepare(state, input);
	assert.equal(state.timelineScenes.value[0].layers.length, 0);
	assert.deepEqual(input, before);
	input.layer.name = 'Changed by caller';
	input.clips[0].startMs = 500;
	prepared.change.apply(state);
	const created = structuredClone(state.timelineScenes.value[0].layers[0]);
	assert.equal(created.id, prepared.result.layerId);
	assert.equal(created.name, 'Caption');
	assert.equal(created.clips[0].startMs, 100);
	state.timelineScenes.value[0].layers[0].name = 'Later edit';
	prepared.change.revert(state);
	prepared.change.apply(state);
	assert.deepEqual(state.timelineScenes.value[0].layers[0], created);
});

// 【素材長は注入した読み取りサービスから取得し、Undo/Redoで再読み込みしない】
// デコーダーの待機中にLayerを先に追加せず、検証失敗時にも履歴へ不完全なLayerを残さない。
test('resolves media during asynchronous preparation and never reads it again for redo', async () => {
	let finish;
	let inspections = 0;
	const { state, manager } = fixture({ inspectMedia: () => { inspections++; return new Promise(resolve => { finish = resolve; }); } });
	const scene = manager.commit('createTimelineScene', {});
	state.assets.value.push({ id: 'sound', fileDataType: 'audio/wav', fileData: new Blob() });
	const pending = manager.execute('createTimelineLayer', {
		sceneId: scene.sceneId, layer: { layerType: 'audio' },
		clips: [{ assetId: 'sound', startMs: 0, durationMs: 500, sourceInMs: 0, sourceOutMs: 500, playbackRate: 1, loop: false }],
	});
	assert.equal(state.timelineScenes.value[0].layers.length, 0);
	finish({ durationMs: 1000, audioAvailable: true, audioError: null });
	const result = await pending;
	const created = structuredClone(state.timelineScenes.value[0].layers[0]);
	assert.equal(created.id, result.layerId);
	manager.undo();
	manager.redo();
	assert.equal(inspections, 1);
	assert.deepEqual(state.timelineScenes.value[0].layers[0], created);
	const bad = manager.execute('createTimelineClip', {
		...result, clip: { assetId: 'sound', startMs: 1000, durationMs: 2000, sourceInMs: 0, sourceOutMs: 2000, playbackRate: 1, loop: false },
	});
	finish({ durationMs: 1000, audioAvailable: true, audioError: null });
	await assert.rejects(bad, /Clip exceeds/);
	assert.deepEqual(state.timelineScenes.value[0].layers[0], created);
	assert.equal(manager.undoStack.value.length, 2);
});

// 【非同期の素材準備中に始まった連続編集を、Layer追加より先に履歴へ確定する】
// 順序が逆転すると、Undoで取り消した色がSceneの復元時に再び現れる。
// 準備完了後に届く古い編集セッションの更新・キャンセルが状態を巻き戻さないことも確認する。
test('finishes edits started during media preparation before applying the prepared command', async () => {
	let finishInspection;
	let inspections = 0;
	const { state, manager } = fixture({ inspectMedia: () => { inspections++; return new Promise(resolve => { finishInspection = resolve; }); } });
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'image' } });
	const before = structuredClone(state.timelineScenes.value);
	const historySize = manager.undoStack.value.length;
	state.assets.value.push({ id: 'sound', fileDataType: 'audio/wav', fileData: new Blob() });
	const pending = manager.execute('createTimelineLayer', {
		...scene, layer: { layerType: 'audio' },
		clips: [{ assetId: 'sound', startMs: 0, durationMs: 500, sourceInMs: 0, sourceOutMs: 500, playbackRate: 1, loop: false }],
	});
	const edit = manager.beginEdit('setTimelineLayerColor');
	edit.update({ ...layer, color: [1, 0, 0, 1] });
	edit.update({ ...layer, color: [0, 1, 0, 1] });
	const colored = structuredClone(state.timelineScenes.value);
	assert.equal(manager.undoStack.value.length, historySize);
	finishInspection({ durationMs: 1000, audioAvailable: true, audioError: null });
	await pending;
	const after = structuredClone(state.timelineScenes.value);
	assert.equal(edit.active, false);
	assert.equal(manager.undoStack.value.length, historySize + 2);
	edit.cancel();
	assert.equal(edit.update({ ...layer, color: [0, 0, 1, 1] }), null);
	edit.finish();
	assert.deepEqual(state.timelineScenes.value, after);
	manager.undo();
	assert.deepEqual(state.timelineScenes.value, colored);
	manager.undo();
	assert.deepEqual(state.timelineScenes.value, before);
	manager.redo();
	assert.deepEqual(state.timelineScenes.value, colored);
	manager.redo();
	assert.deepEqual(state.timelineScenes.value, after);
	assert.equal(inspections, 1);
});

// 【Source変更は加工式を保持し、完全Binding置換は明示された内容だけを保存する】
// 両者を同じ操作にすると、スクリプトによる固定値変更で加工式が消えたり、完全コピーに余分な式が残る。
// APIを先にimportしても、循環参照によってレジストリからCommandが消えないことも検証する。
test('distinguishes source updates from full bindings and avoids history for an identical binding', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'image' } });
	const target = { ...layer, parameterGroup: 'compositing', parameterPath: ['opacity'] };
	const modifier = { enabled: true, code: 'VALUE * 0.5' };
	manager.commit('setTimelineLayerParameterExpressionModifier', { ...target, expressionModifier: modifier });
	manager.commit('setTimelineLayerParameterSource', { ...target, source: { inputSource: 'literal', value: 0.75, expressionModifier: { enabled: false, code: 'ignored' } } });
	const current = () => state.timelineScenes.value[0].layers[0].compositingParamValues.opacity;
	assert.deepEqual(current(), { inputSource: 'literal', value: 0.75, expressionModifier: modifier });
	manager.commit('replaceTimelineLayerParameterBinding', { ...target, binding: { inputSource: 'literal', value: 0.25 } });
	assert.deepEqual(current(), { inputSource: 'literal', value: 0.25 });
	const historySize = manager.undoStack.value.length;
	manager.commit('replaceTimelineLayerParameterBinding', { ...target, binding: { inputSource: 'literal', value: 0.25 } });
	assert.equal(manager.undoStack.value.length, historySize);
});

// 【Scene上のキーは整数msだけを受け付け、無効な値を黙って丸めない】
// Command内部で丸めるとスクリプトが指定した値と保存値が変わる。UIが丸めてから渡す責任を持ち、
// 不正なBindingが入力された場合は既存の固定値も履歴も変更しない。
test('rejects fractional scene keyframe positions without changing the original binding', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'image' } });
	const target = { ...layer, parameterGroup: 'compositing', parameterPath: ['opacity'] };
	const binding = {
		inputSource: 'keyframesTimelineInline', wrapMode: 'clamp', offsetMode: 'start', trimmedDurationMs: null,
		keyframesTimeline: { dataType: { kind: 'scalar' }, isNormalized: false,
			keyframes: [{ id: 'key', x: 0.5, value: 0.5, interpolation: { type: 'linear' } }] },
	};
	const before = structuredClone(state.timelineScenes.value);
	assert.throws(() => manager.commit('replaceTimelineLayerParameterBinding', { ...target, binding }), /integer milliseconds/);
	assert.deepEqual(state.timelineScenes.value, before);
	assert.equal(manager.undoStack.value.length, 2);
});

// 【複製は対象参照だけを受け取り、コンテナ内参照を生成されたIDへ付け替える】
// 呼び出し側がコピーや参照補正をする必要をなくし、外部のLayerへの参照は共有したまま保持する。
test('duplicates layer subtrees from references and remaps internal image references', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const first = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'image', name: 'Source' } });
	const second = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'image', name: 'Mask user' } });
	manager.commit('setTimelineLayerReferenceMask', { ...second, layerMask: { sourceLayerId: first.layerId, channel: 'alpha', inverted: false } });
	const container = manager.commit('wrapTimelineLayers', { ...scene, layerIds: [second.layerId, first.layerId], containerType: 'folder' });
	const [copy] = manager.commit('duplicateTimelineLayers', { ...scene, layerIds: [container.layerId] });
	const duplicated = state.timelineScenes.value[0].layers.find(layer => layer.id === copy.layerId);
	assert.notEqual(copy.layerId, container.layerId);
	assert.notEqual(duplicated.layers[0].id, second.layerId);
	assert.equal(duplicated.layers[0].layerMask.sourceLayerId, duplicated.layers[1].id);
	const snapshot = structuredClone(duplicated);
	manager.undo();
	manager.redo();
	assert.deepEqual(state.timelineScenes.value[0].layers.find(layer => layer.id === copy.layerId), snapshot);
});

// 【既定値に戻したTransformの省略されたBindingも、取得したLayerの再挿入で維持する】
// Transform操作はnullで保存値を削除するため、完全なLayerスナップショットの契約で
// 全パラメータキーを必須にすると、正常な編集後のQueryやコピーが失敗してしまう。
test('accepts snapshots with unset transform bindings without materializing defaults', () => {
	const { state, manager } = fixture();
	const scene = manager.commit('createTimelineScene', {});
	const layer = manager.commit('createTimelineLayer', { ...scene, layer: { layerType: 'text' } });
	manager.commit('setTimelineLayerTransformBindings', { ...layer, bindings: { position: null, rotation: null } });
	const snapshot = structuredClone(state.timelineScenes.value[0].layers[0]);
	assert.equal('position' in snapshot.compositingParamValues, false);
	const copy = manager.commit('insertTimelineLayer', { ...scene, layer: snapshot });
	const inserted = state.timelineScenes.value[0].layers.find(candidate => candidate.id === copy.layerId);
	assert.equal('position' in inserted.compositingParamValues, false);
	assert.equal('rotation' in inserted.compositingParamValues, false);
	manager.undo();
	manager.redo();
	assert.equal('position' in state.timelineScenes.value[0].layers.find(candidate => candidate.id === copy.layerId).compositingParamValues, false);
});
