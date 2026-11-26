import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testNodesEffect } from './helpers/nodes-effect.mjs';
import { nodeParameterTarget, nodeTarget, assetSource } from './helpers/command-inputs.mjs';
import { prepareTestCommand } from './helpers/prepared-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export { COMMAND_DEFS } from './src/commands.ts'; export { getTimelineParameterEditBinding } from './src/commands/timeline-parameter-api.ts'; export { createTimelineCommandDefinitions } from './src/commands/timeline-api.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { canConnectNodeDataTypes } from './src/utility/node-outputs.ts';
		export { commitTimelineParameterEdit } from './src/utility/timeline-parameter-command-actions.ts';
		export { areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
		export { nativeEffectDefinitions as effectDefinitions } from '@gs/subsystems_effect_native-effects/definitions.ts';
		export { preferences } from './src/preferences.ts';
		export { validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/layers/effect/effect-layer.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'effect-layer-test', setup(build) {
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			loader: 'ts', resolveDir: uiDirectory,
			contents: 'export const preferences = { s: {} };',
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, createEffectTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, effectDefinitions, preferences,
	canConnectNodeDataTypes, areNodeDataTypesCompatible, encodeProjectFile, decodeProjectFile, validateTimelineEffectLayer } = module.exports;
const defaultBuzzId = createDefaultParameterBinding(effectDefinitions.testStructArray.paramDefs.buzzs).value[0].id;
// UIイベントの変換も実際のBinding Commandを通し、履歴と保存値を検証する。
const uiParameterEdit = { prepare: (state, input) => COMMAND_DEFS.replaceTimelineLayerParameterBinding.prepare(state, module.exports.getTimelineParameterEditBinding(state, input)) };
// 既存レイヤーデータを必要とするfixtureは、採番を行う作成APIではなくインポート操作を使う。
const importLayer = { prepare: (state, input) => COMMAND_DEFS.insertTimelineAssetLayers.prepare(state, { sceneId: input.sceneId, layers: [input.layer], sourceDurationsMs: input.sourceDurationsMs ?? {} }) };
function mediaCommand(name, { sourceDurationMs, ...input }) {
 const definition = module.exports.createTimelineCommandDefinitions({ inspectMedia: () => ({ durationMs: sourceDurationMs, audioAvailable: true, audioError: null }) })[name];
 return prepareTestCommand(definition, input);
}

const literal = value => ({ inputSource: 'literal', value });
const audioLayer = id => ({ id, name: id, layerType: 'audio', isDisabled: false, clips: [], audioParamValues: { volume: literal(1) }, functionCurves: [] });

// 【指定レイヤーの選択は同じSceneの音声出力だけを許可し、Undo/RedoでIDを維持する】
// UI候補の絞り込みだけではCommandから別Sceneや画像レイヤーを混入できるため、保存前にも検証する。
// 空・無効のレイヤーは後から音声を置けるので有効な選択先とする。
test('edits same-scene audio references with undo, reset, and command validation', () => {
	const f = fixture('audioWaveform');
	const root = f.state.timelineScenes.value[0];
	const video = { ...audioLayer('video'), layerType: 'video', compositingParamValues: {} };
	const child = { ...audioLayer('child'), layerType: 'scene', compositingParamValues: {} };
	const image = { ...audioLayer('image'), layerType: 'image', compositingParamValues: {} };
	root.layers = [{ ...audioLayer('sound'), isDisabled: true }, f.layer, video, child, image];
	f.state.timelineScenes.value.push({ ...root, id: 'other', layers: [audioLayer('outside')] });
	f.edit(['audio'], { kind: 'inputSource', inputSource: 'anotherLayerAudio' });
	assert.deepEqual(f.read(['audio']), { inputSource: 'anotherLayerAudio', layerId: null });
	for (const id of ['sound', 'video', 'child']) {
		const before = structuredClone(f.read(['audio']));
		const command = f.edit(['audio'], { kind: 'anotherLayerAudio', value: id });
		assert.deepEqual(f.read(['audio']), { inputSource: 'anotherLayerAudio', layerId: id });
		command.undo(f.state);
		assert.deepEqual(f.read(['audio']), before);
		command.execute(f.state);
		assert.equal(f.read(['audio']).layerId, id);
	}
	for (const id of ['outside', 'image', f.layer.id, 'missing']) assert.throws(() => f.edit(['audio'], { kind: 'anotherLayerAudio', value: id }), /same scene/);
	assert.equal(f.read(['audio']).layerId, 'child');
	const reset = f.edit(['audio'], { kind: 'reset' });
	assert.deepEqual(f.read(['audio']), { inputSource: 'lowerLayerAudio' });
	reset.undo(f.state);
	assert.equal(f.read(['audio']).layerId, 'child');
	f.edit(['audio'], { kind: 'anotherLayerAudio', value: null });
	assert.equal(f.read(['audio']).layerId, null);
	assert.equal(COMMAND_DEFS.setTimelineLayerParameterSource.prepare(f.state, { sceneId: f.target.sceneId, layerId: f.target.layerId, parameterGroup: 'effect', parameterPath: ['audio'], source: { inputSource: 'anotherLayerAudio', layerId: 'sound' } }).change.changes[0].changes[0].kind, 'connection');
});

// 【音声参照の削除中もIDを保存し、Undoで同じ参照先へ復旧する】
// 削除時に参照を消すと、Undoしても波形の配線を手作業で戻す必要がある。
// 欠落した参照を持つプロジェクトも保存・再読込でき、別パラメータの編集を妨げない。
test('preserves dangling anotherLayerAudio references through deletion, saving, and undo', async () => {
	const f = fixture('audioWaveform');
	f.state.timelineScenes.value[0].layers.push(audioLayer('sound'));
	f.edit(['audio'], { kind: 'anotherLayerAudio', value: 'sound' });
	const remove = prepareTestCommand(COMMAND_DEFS.removeTimelineLayers, { sceneId: 'scene', layerIds: ['sound' ]});
	remove.execute(f.state);
	assert.deepEqual(f.read(['audio']), { inputSource: 'anotherLayerAudio', layerId: 'sound' });
	f.edit(['amplitude'], { kind: 'literal', value: 2 });
	const project = { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, id: 'project', gsVersion: '2.0.0-alpha', name: 'Audio', description: '', author: '', resolution: { width: 800, height: 600 },
		assets: [], generatedSpeech: [], nodesEffects: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	remove.undo(f.state);
	assert.equal(f.state.timelineScenes.value[0].layers.at(-1).id, f.read(['audio']).layerId);
	remove.execute(f.state);
	assert.equal(f.read(['audio']).layerId, 'sound');
});


// 【波形・Spectrumレイヤーは主音声入力を下層へ割り当て、リセットとUndo/Redoでも復元する】
// 音声の主入力を画像の主入力とは別に扱い、生成系の通常合成を維持する。
// 未選択を明示した状態も保存し、自動入力によって勝手に上書きしない。
for (const effectId of ['audioWaveform', 'audioSpectrum']) test(`defaults ${effectId} audio to lower layers and restores overrides through undo and redo`, () => {
	const f = fixture(effectId);
	assert.deepEqual(f.read(['audio']), { inputSource: 'lowerLayerAudio' });
	assert.deepEqual(f.layer.compositingParamValues.blendMode, literal('normal'));
	f.edit(['audio'], { kind: 'literal', value: null });
	const reset = f.edit(['audio'], { kind: 'reset' });
	assert.equal(f.read(['audio']).inputSource, 'lowerLayerAudio');
	reset.undo(f.state);
	assert.deepEqual(f.read(['audio']), literal(null));
	reset.execute(f.state);
	assert.equal(f.read(['audio']).inputSource, 'lowerLayerAudio');
	assert.deepEqual(effectDefinitions[effectId].paramDefs.audio.defaultValue, null);
	assert.equal(f.read(['audio']).inputSource, 'lowerLayerAudio');
});

// 【配列・構造体内でも音声入力だけに下層音声を許可する】
// 親のliteralの中へ別ドメインのBindingを隠せないよう、保存前に末端まで検証する。
// IDパスによるリセット・削除・復元は通常のパラメータと同じCommandを利用する。
test('validates and edits nested audio bindings using stable parameter paths', t => {
	const audio = effectDefinitions.audioWaveform.paramDefs.audio;
	effectDefinitions.nestedAudio = { ...effectDefinitions.audioWaveform, id: 'nestedAudio', primaryAudioInputParameter: null, paramDefs: {
		inputs: { dataType: { kind: 'array', elementType: { kind: 'struct', fields: { source: audio.dataType } } },
			ui: { label: 'Inputs', control: { element: { fields: { source: audio.ui } } } },
			element: { fields: { source: { defaultValue: null, canNode: false } }, defaultValue: { source: null } },
			defaultValue: [{ source: null }] },
	} };
	t.after(() => { delete effectDefinitions.nestedAudio; });
	const f = fixture('nestedAudio');
	// 保存値のない配列を表示したIDで編集し、Undo後も同じパスから既定値を読める。
	delete f.layer.effectParamValues.inputs;
	const elementId = f.read(['inputs']).value[0].id;
	const path = ['inputs', elementId, 'source'];
	assert.deepEqual(f.read(path), literal(null));
	const firstEdit = f.edit(path, { kind: 'inputSource', inputSource: 'lowerLayerAudio' });
	assert.equal(f.layer.effectParamValues.inputs.value[0].id, elementId);
	firstEdit.undo(f.state);
	assert.equal(Object.hasOwn(f.layer.effectParamValues, 'inputs'), false);
	assert.deepEqual(f.read(path), literal(null));
	firstEdit.execute(f.state);
	assert.equal(f.read(path).inputSource, 'lowerLayerAudio');
	const reset = f.edit(path, { kind: 'reset' });
	assert.deepEqual(f.read(path), literal(null));
	reset.undo(f.state);
	assert.equal(f.read(path).inputSource, 'lowerLayerAudio');
	f.state.timelineScenes.value[0].layers.push(audioLayer('sound'));
	f.edit(path, { kind: 'anotherLayerAudio', value: 'sound' });
	assert.deepEqual(f.read(path), { inputSource: 'anotherLayerAudio', layerId: 'sound' });
	const remove = f.edit(['inputs'], { kind: 'removeElement', elementId });
	assert.deepEqual(f.read(['inputs']).value, []);
	remove.undo(f.state);
	assert.deepEqual(f.read(path), { inputSource: 'anotherLayerAudio', layerId: 'sound' });
	assert.throws(() => f.edit(path, { kind: 'anotherLayerAudio', value: 'outside' }), /same scene/);
});

// 【公開音声入力の指定と引数の既定値を保存し、定義編集とUndoで対応を維持する】
// 主音声入力のメタデータはNodes Effectが所有し、エフェクト定義やパラメータ自体へ役割を混ぜない。
// 音声型からの変更・削除で参照を解除し、Undoでは元のIDと設定を復元する。
test('edits primary audio parameters and timeline arguments with independent undo history', () => {
	const f = fixture('audioWaveform');
	const audio = { ...effectDefinitions.audioWaveform.paramDefs.audio, id: 'sound', nameForReference: 'sound', canNode: false };
	const nodesEffect = { id: 'visual', definition: testNodesEffect({ customParameterValues: {}, nodes: [], primaryOutput: null, primaryInputParameter: null, primaryAudioInputParameter: null, paramDefs: { [audio.id]: audio }, functionCurves: [] }) };
	f.state.nodesEffects.value.push(nodesEffect);
	const command = (name, payload) => prepareTestCommand(COMMAND_DEFS[name], payload);
	const primary = command('setNodesEffectPrimaryAudioInput', { target: { nodesEffectId: nodesEffect.id }, primaryAudioInputId: 'sound' });
	primary.execute(f.state);
	assert.equal(nodesEffect.definition.primaryAudioInputParameter, 'sound');
	primary.undo(f.state);
	assert.equal(nodesEffect.definition.primaryAudioInputParameter, null);
	primary.execute(f.state);
	assert.throws(() => command('setNodesEffectPrimaryAudioInput', { target: { nodesEffectId: nodesEffect.id }, primaryAudioInputId: 'missing' }).execute(f.state));
	const layer = { ...f.layer, layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'visual' }, effectParamValues: {} };
	f.state.timelineScenes.value[0].layers = [layer];
	assert.deepEqual(resolveLayerParameter(f.state, layer, 'effect', ['sound']).value, { inputSource: 'lowerLayerAudio' });
	const none = prepareTestCommand(uiParameterEdit, { ...f.target, target: 'effect', paramPath: ['sound'], edit: { kind: 'literal', value: null } });
	none.execute(f.state);
	assert.deepEqual(layer.effectParamValues.sound, literal(null));
	const reset = prepareTestCommand(uiParameterEdit, { ...f.target, target: 'effect', paramPath: ['sound'], edit: { kind: 'reset' } });
	reset.execute(f.state);
	assert.deepEqual(layer.effectParamValues.sound, { inputSource: 'lowerLayerAudio' });
	reset.undo(f.state);
	assert.deepEqual(layer.effectParamValues.sound, literal(null));
	none.undo(f.state);
	assert.equal(Object.hasOwn(layer.effectParamValues, 'sound'), false);
	f.state.timelineScenes.value[0].layers.push(audioLayer('source'));
	const selected = prepareTestCommand(uiParameterEdit, { ...f.target, target: 'effect', paramPath: ['sound'], edit: { kind: 'anotherLayerAudio', value: 'source' } });
	selected.execute(f.state);
	assert.deepEqual(layer.effectParamValues.sound, { inputSource: 'anotherLayerAudio', layerId: 'source' });
	assert.deepEqual(nodesEffect.definition.paramDefs.sound.defaultValue, null);
	selected.undo(f.state);
	assert.equal(Object.hasOwn(layer.effectParamValues, 'sound'), false);
	selected.execute(f.state);
	for (const [name, payload] of [
		['removeNodesEffectPublicParameter', { target: { nodesEffect: { nodesEffectId: nodesEffect.id }, parameterId: 'sound' } }],
		['replaceNodesEffectPublicParameterDefinition', { target: { nodesEffect: { nodesEffectId: nodesEffect.id }, parameterId: 'sound' }, definition: { ...audio, dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: 0 } }],
	]) {
		const edit = command(name, payload);
		edit.execute(f.state);
		assert.equal(nodesEffect.definition.primaryAudioInputParameter, null);
		assert.equal(Object.hasOwn(layer.effectParamValues, 'sound'), false);
		edit.undo(f.state);
		assert.equal(nodesEffect.definition.primaryAudioInputParameter, 'sound');
		assert.equal(nodesEffect.definition.paramDefs.sound.dataType.kind, 'audioSource');
		assert.deepEqual(layer.effectParamValues.sound, { inputSource: 'anotherLayerAudio', layerId: 'source' });
	}
	assert.throws(() => command('replaceNodesEffectPublicParameterDefinition', { target: { nodesEffect: { nodesEffectId: nodesEffect.id }, parameterId: 'sound' }, definition: { ...audio, canNode: true } }).execute(f.state));
});

// 【Timelineで入れ子の音声入力を初期化するときは未選択にする】
// Nodes Effectの公開音声入力は、配置側で接続される。
// 配置、要素追加、リセット、定義更新のどの経路でも、Timelineに有効なBindingを生成する。
test('uses unselected audio bindings for nested audio defaults in effect layers', () => {
	const { state } = fixture('audioWaveform');
	const audio = effectDefinitions.audioWaveform.paramDefs.audio;

	const tracks = {
		nameForReference: 'tracks', canNode: false,
		dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: audio.dataType } } },
		ui: { label: 'Tracks', control: { element: { fields: { audio: audio.ui } } } },
		defaultValue: [{ audio: null }],
		element: { defaultValue: { audio: null }, fields: { audio: { defaultValue: null } } },
	};
	const definition = testNodesEffect({ paramDefs: { tracks } });
	const effectSource = { type: 'nodesEffectReference', id: 'audio-graph' };
	const registered = { id: effectSource.id, definition };
	state.nodesEffects.value.push(registered);
	const layer = createEffectTimelineLayer({ ...definition, displayName: 'Audio graph', effectSource }, 0);
	state.timelineScenes.value[0].layers = [layer];
	const validateLayer = () => validateTimelineEffectLayer(layer, { getNodesEffect: () => registered.definition });
	validateLayer();
	const firstElementId = layer.effectParamValues.tracks.value[0].id;
	const read = path => resolveLayerParameter(state, layer, 'effect', path).value;
	assert.deepEqual(read(['tracks', firstElementId, 'audio']), literal(null));
	delete layer.effectParamValues.tracks;
	assert.deepEqual(read(['tracks', firstElementId, 'audio']), literal(null));

	const target = { sceneId: 'scene', layerId: layer.id, parameterGroup: 'effect' };
	const insert = prepareTestCommand(COMMAND_DEFS.insertTimelineLayerParameterArrayElement, { ...target, parameterPath: ['tracks'] });
	insert.execute(state);
	const addedElementId = layer.effectParamValues.tracks.value[1].id;
	const addedAudio = { ...target, parameterPath: ['tracks', addedElementId, 'audio'] };
	assert.deepEqual(read(addedAudio.parameterPath), literal(null));
	prepareTestCommand(COMMAND_DEFS.setTimelineLayerParameterSource, { ...addedAudio, source: { inputSource: 'lowerLayerAudio' } }).execute(state);
	prepareTestCommand(COMMAND_DEFS.resetTimelineLayerParameter, addedAudio).execute(state);
	assert.deepEqual(read(addedAudio.parameterPath), literal(null));

	prepareTestCommand(COMMAND_DEFS.replaceNodesEffectPublicParameterDefinition, {
		target: { nodesEffect: { nodesEffectId: effectSource.id }, parameterId: 'tracks' },
		definition: {
			...tracks,
			dataType: { kind: 'array', elementType: { kind: 'struct', fields: { audio: audio.dataType, secondary: audio.dataType } } },
			ui: { label: 'Tracks', control: { element: { fields: { audio: audio.ui, secondary: audio.ui } } } },
			defaultValue: [{ audio: null, secondary: null }],
			element: { defaultValue: { audio: null, secondary: null },
				fields: { audio: { defaultValue: null }, secondary: { defaultValue: null } } },
		},
	}).execute(state);
	assert.deepEqual(read(['tracks', addedElementId, 'secondary']), literal(null));
	assert.deepEqual(registered.definition.paramDefs.tracks.defaultValue, [{ audio: null, secondary: null }]);
	validateLayer();
});

// 【すべてのエフェクトを既定値のままレイヤーとして作成できる】
// タイムライン向けの候補制限は設けないため、配列・構造体の既定値もレイヤーのBinding制約に従う必要がある。
test('creates every bundled effect without illegal binding defaults', () => {
	for (const [id, definition] of Object.entries(effectDefinitions)) {
		if (definition.outputDefs[definition.primaryOutput]?.dataType.kind !== 'color') continue;
		assert.ok(['generate', 'modify'].includes(definition.kind), definition.id);
		validateTimelineEffectLayer(createEffectTimelineLayer({ ...definition, effectSource: { type: 'nativeEffect', id } }, 0), { getNativeEffect: key => effectDefinitions[key] });
	}
});

function fixture(effectId = 'testStructArray') {
	const layer = createEffectTimelineLayer({ ...effectDefinitions[effectId], effectSource: { type: 'nativeEffect', id: effectId } }, 100);
	const state = { timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] }, nodesEffects: { value: [] }, assets: { value: [] } };
	const target = { sceneId: 'scene', layerId: layer.id, target: 'effect' };
	const edit = (paramPath, edit) => {
		const command = prepareTestCommand(uiParameterEdit, { ...target, paramPath, edit });
		command.execute(state);
		return command;
	};
	return { layer, state, target, edit, read: path => resolveLayerParameter(state, layer, 'effect', path).value };
}

// 【LUT選択・差し替え・削除をCommandで戻せる】
// ノードの参照解除とUndoによる復元を確認する。タイムラインの参照切れは既存のAssetと同様に
// IDを保持して検証側で通知し、Undoしたときに同じ素材へ戻れるようにする。
test('edits and restores LUT assets and references through commands', async () => {
	const f = fixture('applyLut');
	const original = { id: 'lut', name: 'Look', width: 0, height: 0, fileDataType: 'application/x-cube-lut',
		fileData: new Blob(['LUT_1D_SIZE 2\n0 0 0\n1 1 1']), sourceFilePath: null, thumbnailSequence: null };
	f.state.assets.value.push(original);
	const selection = prepareTestCommand(COMMAND_DEFS.setTimelineLayerStaticSetting, { sceneId: 'scene', layerId: f.layer.id, key: 'lut', value: 'lut' });
	selection.execute(f.state);
	assert.equal(f.layer.effectStaticSettings.lut, 'lut');
	selection.undo(f.state);
	assert.equal(f.layer.effectStaticSettings.lut, null);
	selection.execute(f.state);
	const replacement = prepareTestCommand(COMMAND_DEFS.replaceAssetSource, { assetId: 'lut', source: assetSource({ ...original, fileData: new Blob(['replacement']) }) });
	replacement.execute(f.state);
	assert.equal(await f.state.assets.value[0].fileData.text(), 'replacement');
	replacement.undo(f.state);
	assert.equal(await f.state.assets.value[0].fileData.text(), 'LUT_1D_SIZE 2\n0 0 0\n1 1 1');
	f.state.nodesEffects.value.push({ id: 'visual', definition: testNodesEffect({ nodes: [{ id: 'lut-node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'applyLut' },
		staticSettings: { lut: 'lut' }, params: { input: literal([0, 0, 0, 0]) } }] }) });
	const removal = prepareTestCommand(COMMAND_DEFS.removeAsset, { assetId: 'lut' });
	removal.execute(f.state);
	assert.equal(f.state.assets.value.length, 0);
	assert.equal(f.state.nodesEffects.value[0].definition.nodes[0].staticSettings.lut, null);
	assert.equal(f.layer.effectStaticSettings.lut, 'lut');
	removal.undo(f.state);
	assert.equal(f.state.nodesEffects.value[0].definition.nodes[0].staticSettings.lut, 'lut');
	assert.equal(f.state.assets.value[0].id, 'lut');
});

// 【キーの行は編集対象を区別し、配列の並び替え後も同じIDを指す】
// エフェクトと合成設定が同じ表示名を持っても、対象とパスで独立して識別する。
// 配列の並び替えで選択キーや参照先のIDを変更しない。
test('identifies keyframe rows by owner and stable parameter paths after reordering', t => {
	effectDefinitions.labelProbe = { ...effectDefinitions.testStructArray, id: 'labelProbe', paramDefs: {
		...effectDefinitions.testStructArray.paramDefs,
		opacity: { dataType: { kind: 'scalar' }, ui: { label: 'Opacity', control: { controlType: 'number' } }, defaultValue: 1 },
	} };
	t.after(() => { delete effectDefinitions.labelProbe; });
	const f = fixture('labelProbe');
	f.edit(['opacity'], { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	prepareTestCommand(uiParameterEdit, { ...f.target, target: 'compositing', paramPath: ['opacity'],
		edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } }).execute(f.state);
	const path = ['buzzs', defaultBuzzId, 'x'];
	f.edit(path, { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const rows = getLayerKeyframeParameters(f.state, f.layer);
	assert.deepEqual(rows.map(({ target, paramPath }) => ({ target, paramPath })), [
		{ target: 'compositing', paramPath: ['opacity'] },
		{ target: 'effect', paramPath: path },
		{ target: 'effect', paramPath: ['opacity'] },
	]);
	const original = rows.find(row => row.paramPath.length > 1);
	f.edit(['buzzs'], { kind: 'addElement' });
	f.read(['buzzs']).value.reverse();
	const moved = getLayerKeyframeParameters(f.state, f.layer).find(row => row.key === original.key);
	assert.deepEqual(moved.paramPath, path);
	assert.deepEqual(moved.binding, original.binding);
	assert.equal(f.read(['buzzs']).value[1].id, path[1]);
});

// 【主入力がある生成系と加工系で初期入力・合成を分ける】
// 背景入力の存在だけでGridを加工系にすると背景を二重に合成してしまう。
// リセットはレイヤーとしての初期入力に戻し、共有するエフェクト定義を変更しない。
// 座標空間の初期値は生成系・加工系とも画面配置とし、パラメータBindingには含めない。
test('initializes kinds independently of primary input presence and resets the lowerLayerOutput binding', () => {
	const generated = fixture('grid');
	assert.equal(generated.layer.transformTarget, 'image');
	assert.deepEqual(generated.layer.effectParamValues.background, literal(effectDefinitions.grid.paramDefs.background.defaultValue));
	assert.deepEqual(generated.layer.compositingParamValues.blendMode, literal('normal'));
	const modified = fixture('colorMix');
	assert.equal(modified.layer.transformTarget, 'region');
	for (const { layer } of [generated, modified]) {
		assert.equal(layer.coordinateSpace, 'screen');
		assert.equal('coordinateSpace' in layer.compositingParamValues, false);
		assert.equal('placement' in layer.compositingParamValues, false);
	}
	assert.deepEqual(modified.read(['inputA']), { inputSource: 'lowerLayerOutput' });
	assert.deepEqual(modified.layer.compositingParamValues.blendMode, literal('replace'));
	modified.edit(['inputA'], { kind: 'literal', value: [1, 0, 0, 1] });
	assert.equal(modified.layer.transformTarget, 'region');
	const reset = modified.edit(['inputA'], { kind: 'reset' });
	assert.equal(modified.read(['inputA']).inputSource, 'lowerLayerOutput');
	reset.undo(modified.state);
	assert.deepEqual(modified.read(['inputA']), literal([1, 0, 0, 1]));
	reset.execute(modified.state);
	assert.deepEqual(effectDefinitions.colorMix.paramDefs.inputA.defaultValue, [0, 0, 0, 0]);
	assert.deepEqual(modified.layer.resolution, { mode: 'auto', scale: 1 });
	const noPrimary = createEffectTimelineLayer({ ...effectDefinitions.grid, kind: 'modify', primaryInputParameter: null }, 0);
	assert.equal(noPrimary.effectParamValues.background.inputSource, 'literal');
});

// 【変形対象は入力接続やFitから独立して切り替え、Undo/Redoで復元する】
// 入力を変更してもモードを推測し直さず、範囲モードから戻したときに元の画像設定を利用できるようにする。
test('changes the effect transform target without rewriting inputs or compositing bindings', () => {
	const f = fixture('colorMix');
	const bindings = structuredClone(f.layer.compositingParamValues);
	const inputs = structuredClone(f.layer.effectParamValues);
	const command = prepareTestCommand(COMMAND_DEFS.setTimelineLayerTransformTarget, { sceneId: 'scene', layerId: f.layer.id, transformTarget: 'image' });
	command.execute(f.state);
	assert.equal(f.layer.transformTarget, 'image');
	command.undo(f.state);
	assert.equal(f.layer.transformTarget, 'region');
	command.execute(f.state);
	assert.equal(f.layer.transformTarget, 'image');
	assert.deepEqual(f.layer.effectParamValues, inputs);
	assert.deepEqual(f.layer.compositingParamValues, bindings);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.setTimelineLayerTransformTarget, { sceneId: 'scene', layerId: f.layer.id, transformTarget: 'invalid' }).execute(f.state), /input: transformTarget:/);
});

// 【要素の並べ替え・削除・Undo/Redo後もIDパスでキーを扱う】
// キーをレイヤーの別テーブルへ分離せず要素内のBindingに保持し、削除と復元を一つの操作にする。
test('edits nested scene-time keyframes and preserves identity through array operations', () => {
	const f = fixture();
	const path = ['buzzs', defaultBuzzId, 'x'];
	f.edit(path, { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const binding = f.read(path);
	assert.equal(binding.offsetMode, 'start');
	assert.equal(binding.wrapMode, 'clamp');
	assert.equal(binding.keyframesTimeline.isNormalized, false);
	f.edit(path, { kind: 'keyframesTimelineInline', value: { ...binding, keyframesTimeline: { ...binding.keyframesTimeline,
		keyframes: [{ id: 'key', x: 120.6, value: 0.5, interpolation: { type: 'linear' } }] } } });
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	const add = f.edit(['buzzs'], { kind: 'addElement' });
	const addedId = f.read(['buzzs']).value[1].id;
	add.undo(f.state);
	add.execute(f.state);
	assert.equal(f.read(['buzzs']).value[1].id, addedId);
	f.read(['buzzs']).value.reverse();
	const move = prepareTestCommand(COMMAND_DEFS.moveTimelineKeyframes, { sceneId: 'scene', positions: [{ ...f.target, paramPath: path, keyframeId: 'key', x: 400 }] });
	move.execute(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 400);
	move.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(param => param.paramPath), [path]);
	const remove = f.edit(['buzzs'], { kind: 'removeElement', elementId: defaultBuzzId });
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 0);
	assert.throws(() => f.edit(path, { kind: 'literal', value: 1 }), /Unknown array element/);
	remove.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	const reset = f.edit(['buzzs'], { kind: 'reset' });
	const resetId = f.read(['buzzs']).value[0].id;
	assert.notEqual(resetId, defaultBuzzId);
	reset.undo(f.state);
	reset.execute(f.state);
	assert.equal(f.read(['buzzs']).value[0].id, resetId);
});

// 【非主入力の配列要素にも下層入力を設定し、利用スコープと型互換性を分ける】
// 画像出力の型不一致を許可しても、入力できる場所の制約は維持する。
// canNodeでない末端・コンテナ・合成設定・Nodes Effect内部には下層入力を流さない。
test('supports secondary lowerLayerOutput bindings and enforces their scope and type compatibility', () => {
	const f = fixture();
	const path = ['buzzs', defaultBuzzId, 'image'];
	f.edit(path, { kind: 'inputSource', inputSource: 'lowerLayerOutput' });
	f.edit(path, { kind: 'lowerLayerOutput', value: { ...f.read(path), sampling: { fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } } });
	assert.equal(f.read(path).sampling.filterMode, 'nearest');
	assert.throws(() => prepareTestCommand(uiParameterEdit, { ...f.target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'inputSource', inputSource: 'lowerLayerOutput' } }).execute(f.state));
	for (const inputSource of ['node', 'nodesEffectPublicParameterReference']) assert.throws(() => f.edit(path, { kind: 'inputSource', inputSource }));
	const input = { kind: 'scalar' };
	assert.equal(areNodeDataTypesCompatible({ kind: 'color' }, input), false);
	assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), true);
	preferences.s.forceTypeSafety = true;
	try {
		assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), false);
		const layer = fixture('colorMix');
		const manager = { state: layer.state, commit(name, input) { return prepareTestCommand(COMMAND_DEFS[name], input).execute(layer.state); } };
		const edit = edit => module.exports.commitTimelineParameterEdit(manager, { ...layer.target, target: 'effect', paramPath: ['amount'], edit });
		const connect = () => edit({ kind: 'inputSource', inputSource: 'lowerLayerOutput' });
		assert.throws(connect, /Timeline image output type does not match/);
		preferences.s.forceTypeSafety = false;
		connect();
		assert.equal(layer.read(['amount']).inputSource, 'lowerLayerOutput');
		preferences.s.forceTypeSafety = true;
		edit({ kind: 'lowerLayerOutput', value: { inputSource: 'lowerLayerOutput', sampling: { fitMode: 'contain', wrapMode: 'clamp', filterMode: 'nearest' } } });
		assert.equal(layer.read(['amount']).sampling.filterMode, 'nearest');
	} finally {
		preferences.s.forceTypeSafety = false;
	}
	for (const kind of ['color', 'any']) assert.equal(canConnectNodeDataTypes({ kind: 'color' }, { kind }), true);
});

// 【エフェクト・解像度・ネストしたBindingをプロジェクト保存で維持する】
// クリップ追加や解像度変更でもエフェクト種別とパラメータの所有者はレイヤーのままにする。
test('round trips effect layers and changes resolution and clips with undo', async () => {
	const f = fixture();
	f.edit(['buzzs', defaultBuzzId, 'image'], { kind: 'inputSource', inputSource: 'lowerLayerOutput' });
	const resolution = prepareTestCommand(COMMAND_DEFS.setTimelineEffectLayerResolution, { ...f.target, resolution: { mode: 'customAbsolute', width: 640, height: 360 } });
	resolution.execute(f.state);
	const add = prepareTestCommand(COMMAND_DEFS.createTimelineClip, { ...f.target, clip: { id: 'second', startMs: 6000, durationMs: 1000, contentOffsetMs: 50.25 } });
	add.execute(f.state);
	const project = { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, id: 'project', gsVersion: '2.0.0-alpha', name: 'Test', description: '', author: '', resolution: { width: 800, height: 600 },
		assets: [], generatedSpeech: [], nodesEffects: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	resolution.undo(f.state);
	assert.deepEqual(f.layer.resolution, { mode: 'auto', scale: 1 });
	add.undo(f.state);
	assert.equal(f.layer.clips.length, 1);
	assert.equal(f.read(['buzzs', defaultBuzzId, 'image']).inputSource, 'lowerLayerOutput');
});

// 【ノードとエフェクトレイヤーの倍率を保存し、Undo/Redoで正確に復元する】
// どちらの設定も同じ検証を使い、不正値は現在の設定を変更する前に拒否する。
// インラインのNodes Effectも登録済みと同じCommand経路で編集できる必要がある。
test('saves local resolution scales and validates undoable edits for nodes and effect layers', async () => {
	const f = fixture();
	const node = { id: 'node', type: 'effect', effectSource: { type: 'nativeEffect', id: 'testStructArray' }, resolution: { mode: 'auto', scale: 1 }, staticSettings: {}, params: {} };
	const nodesEffect = { id: 'visual', definition: testNodesEffect({ customParameterValues: {}, nodes: [node] }) };
	f.state.nodesEffects.value.push(nodesEffect);
	const inlineNode = structuredClone(node);
	f.state.timelineScenes.value[0].layers.push({ id: 'inline', layerType: 'effect', effectSource: { type: 'inlineNodesEffect', nodesEffect: testNodesEffect({ nodes: [inlineNode] }) } });
	for (const [definition, target, owner] of [
		[COMMAND_DEFS.setNodesEffectNodeResolution, { target: nodeTarget({ nodesEffectId: 'visual', nodeId: node.id }) }, node],
		[COMMAND_DEFS.setNodesEffectNodeResolution, { target: nodeTarget({ sceneId: 'scene', layerId: 'inline', nodeId: inlineNode.id }) }, inlineNode],
		[COMMAND_DEFS.setTimelineEffectLayerResolution, f.target, f.layer],
	]) {
		assert.deepEqual(owner.resolution, { mode: 'auto', scale: 1 });
		for (const resolution of [{ mode: 'context', scale: 0.5 }, { mode: 'auto', scale: 2.5 }]) {
			const before = structuredClone(owner.resolution);
			const command = prepareTestCommand(definition, { ...target, resolution });
			command.execute(f.state);
			assert.deepEqual(owner.resolution, resolution);
			command.undo(f.state);
			assert.deepEqual(owner.resolution, before);
			command.execute(f.state);
			assert.deepEqual(owner.resolution, resolution);
			for (const scale of [0, -1, NaN, Infinity]) {
				assert.throws(() => prepareTestCommand(definition, { ...target, resolution: { mode: resolution.mode, scale } }).execute(f.state), /scale/);
				assert.deepEqual(owner.resolution, resolution);
			}
		}
	}
	const project = { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, id: 'project', gsVersion: '2.0.0-alpha', name: 'Test', description: '', author: '', resolution: { width: 800, height: 600 },
		assets: [], generatedSpeech: [], nodesEffects: f.state.nodesEffects.value, timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
});

// 【ネストした別レイヤー出力の段階とサンプリングをUndo/Redoで維持する】
// 画像入力の新方式でもIDパスによる編集を使い、他Scene・自身・非映像レイヤーを
// Commandから混入できないようにする。参照先削除後も保存したIDは復旧に備えて残す。
test('edits nested image references and preserves their stages through undo and deletion', () => {
	const f = fixture();
	const root = f.state.timelineScenes.value[0];
	const source = createEffectTimelineLayer({ ...effectDefinitions.testStructArray, effectSource: { type: 'nativeEffect', id: 'testStructArray' } }, 100);
	root.layers.push(source, audioLayer('audio'));
	const path = ['buzzs', defaultBuzzId, 'image'];
	f.edit(path, { kind: 'inputSource', inputSource: 'anotherLayerOutput' });
	assert.deepEqual(f.read(path), { inputSource: 'anotherLayerOutput', layerId: null, outputStage: 'source' });
	const edit = f.edit(path, { kind: 'anotherLayerOutput', value: { ...f.read(path), layerId: source.id, outputStage: 'rendered', sampling: { filterMode: 'nearest', fitMode: 'cover', wrapMode: 'repeatMirrored' } } });
	edit.undo(f.state);
	assert.equal(f.read(path).layerId, null);
	edit.execute(f.state);
	assert.equal(f.read(path).sampling.filterMode, 'nearest');
	for (const id of [f.layer.id, 'audio', 'another-scene-layer']) assert.throws(() => f.edit(path, { kind: 'anotherLayerOutput', value: { ...f.read(path), layerId: id } }));
	const remove = prepareTestCommand(COMMAND_DEFS.removeTimelineLayers, { sceneId: 'scene', layerIds: [source.id ]});
	remove.execute(f.state);
	assert.equal(f.read(path).layerId, source.id);
	f.edit(path, { kind: 'anotherLayerOutput', value: { ...f.read(path), outputStage: 'composited' } });
	assert.equal(f.read(path).outputStage, 'composited');
	remove.undo(f.state);
	assert.equal(root.layers.some(layer => layer.id === f.read(path).layerId), true);
});

// 【Nodes Effectの主入力を編集でき、リセットで下層へ戻し、公開側にはサンプリングを保存しない】
// 従来の主入力専用の自動割当と編集禁止が残ると、明示Bindingを設定しても使えない。
// 通常引数と同じCommand・Undo/Redoを使いつつ、共有Nodes Effectの定義は変更しない。
test('edits public primary image inputs and resets them to lower layers', () => {
	const f = fixture();
	const visual = { id: 'visual', definition: testNodesEffect({ primaryInputParameter: 'image',
		paramDefs: { image: { nameForReference: 'image', dataType: { kind: 'color' }, ui: { label: 'Image', control: {} }, canNode: true, defaultValue: [0, 0, 0, 0] } } }) };
	f.state.nodesEffects.value.push(visual);
	const publicLayer = { id: 'public', layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'visual' }, effectParamValues: {}, functionCurves: [] };
	f.state.timelineScenes.value[0].layers.push(publicLayer);
	const read = () => resolveLayerParameter(f.state, publicLayer, 'effect', ['image']).value;
	const edit = value => { const command = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', layerId: 'public', target: 'effect', paramPath: ['image'], edit: value }); command.execute(f.state); return command; };
	assert.deepEqual(read(), { inputSource: 'lowerLayerOutput' });
	edit({ kind: 'inputSource', inputSource: 'anotherLayerOutput' });
	const binding = { inputSource: 'anotherLayerOutput', layerId: f.layer.id, outputStage: 'source' };
	edit({ kind: 'anotherLayerOutput', value: binding });
	assert.deepEqual(read(), binding);
	const reset = edit({ kind: 'reset' });
	assert.deepEqual(read(), { inputSource: 'lowerLayerOutput' });
	reset.undo(f.state);
	assert.deepEqual(read(), binding);
	assert.deepEqual(visual.definition.paramDefs.image.defaultValue, [0, 0, 0, 0]);
});
