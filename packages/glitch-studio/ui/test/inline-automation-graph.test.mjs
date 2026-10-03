import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// GPU・ストレージに依存する登録情報だけ差し替え、実際のコマンドとパラメータ解決を使う。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/keyframes-timeline.ts'; export { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts'; export { COMMAND_DEFS } from './src/commands.ts'; export { createInlineAutomationGraph, setInlineAutomationGraphNormalized } from './src/utility/automation-graph.ts'; export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts'; export { createImageLayer } from './src/utility/image-layer.ts'; export { getLayerParameterTargets } from './src/utility/timeline-scene.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)),
		loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{
		name: 'inline-graph-test-dependencies',
		setup(build) {
			build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'inline-graph-test' }));
			build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'inline-graph-test' }));
			build.onLoad({ filter: /.*/, namespace: 'inline-graph-test' }, ({ path }) => ({
				contents: path === 'preferences'
					? 'export const preferences = { s: { forceTypeSafety: false } };'
					: `export const effectDefinitions = { test: { paramDefs: {
						values: { dataType: { kind: 'array', elementType: { kind: 'scalar' } }, ui: { label: 'Values', control: { element: { controlType: 'number' } } }, element: { defaultValue: { inputSource: 'literal', value: 0 } }, defaultValue: { inputSource: 'literal', value: [] } }
					} } };`,
				loader: 'ts',
			}));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { timelineCompositingParamDefs, COMMAND_DEFS, createInlineAutomationGraph, setInlineAutomationGraphNormalized, encodeProjectFile, decodeProjectFile, createImageLayer, getLayerParameterTargets } = module.exports;

const defaultCompositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, structuredClone(def.defaultValue)]));
const { createInlineKeyframesTimeline, insertInlineKeyframe, updateInlineKeyframe, canEditKeyframesTimeline } = module.exports;

const keyframeDefinition = (dataType, value) => ({ dataType, defaultValue: { inputSource: 'literal', value }, ui: { label: 'Value', control: {} } });

// 【キーフレームへの切り替えは現在の値を維持し、型ごとに正しい初期キーを作る】
// 数値の0→1を一律に生成すると、変換した瞬間に文字や色が変わってしまう。
// false・空文字列を欠損値と扱わず、式からの切り替えは定義の初期値に戻す。
test('creates one typed keyframe from the current literal or definition default', () => {
	for (const [kind, current, fallback, interpolation] of [
		['scalar', 0.7, 1, 'linear'], ['vector', [2, -1], [0, 0], 'linear'],
		['color', [1, 0, 0, 0.5], [0, 0, 0, 1], 'linear'],
		['string', '', 'Default', 'hold'], ['bool', false, true, 'hold'], ['enum', 'b', 'a', 'hold'],
	]) {
		const definition = keyframeDefinition(kind === 'enum' ? { kind, options: ['a', 'b'] } : { kind }, fallback);
		const input = createInlineKeyframesTimeline(definition, { inputSource: 'literal', value: current });
		assert.equal(input.keyframesTimeline.isNormalized, false);
		assert.equal(input.offsetMode, 'start');
		assert.equal(input.wrapMode, 'clamp');
		assert.equal(input.keyframesTimeline.keyframes.length, 1);
		assert.deepEqual(input.keyframesTimeline.keyframes[0].value, current);
		assert.equal(input.keyframesTimeline.keyframes[0].x, 0);
		assert.equal(input.keyframesTimeline.keyframes[0].interpolation.type, interpolation);
		assert.deepEqual(createInlineKeyframesTimeline(definition, { inputSource: 'expression', expression: 'TIME' }).keyframesTimeline.keyframes[0].value, fallback);
		if (Array.isArray(current)) assert.notEqual(input.keyframesTimeline.keyframes[0].value, current);
	}
});

// 【キーを追加しても元の数値補間や離散値の区間を変えない】
// 文字列を配列へ展開したり、boolを数値化したりせず、同時刻では既存キーを選択する。
// 区間外の挿入にはRepeatを適用せず、端の値を複製する。
test('splits keyframe intervals without changing values and reuses existing keys', () => {
	for (const [kind, first, last, midpoint] of [
		['scalar', 2, 10, 6], ['vector', [0, 2], [4, 6], [2, 4]],
		['color', [1, 0, 0, 0], [0, 1, 0, 1], [0.5, 0.5, 0, 0.5]],
		['string', ' Hello\n世界 👋 ', '', ' Hello\n世界 👋 '], ['bool', true, false, true], ['enum', 'a', 'b', 'a'],
	]) {
		const definition = keyframeDefinition(kind === 'enum' ? { kind, options: ['a', 'b'] } : { kind }, first);
		const input = createInlineKeyframesTimeline(definition);
		input.keyframesTimeline.keyframes.push({ ...input.keyframesTimeline.keyframes[0], id: 'last', x: 10000, value: last });
		const before = structuredClone(input);
		const inserted = insertInlineKeyframe(input, definition, 5000, 20000);
		assert.deepEqual(inserted.value.keyframesTimeline.keyframes[1].value, midpoint);
		assert.deepEqual(input, before);
		const existing = insertInlineKeyframe(inserted.value, definition, 5000, 20000);
		assert.equal(existing.value, inserted.value);
		assert.equal(existing.keyframeId, inserted.keyframeId);
		input.wrapMode = 'repeat';
		const outside = insertInlineKeyframe(input, definition, 15000, 20000);
		assert.deepEqual(outside.value.keyframesTimeline.keyframes.at(-1).value, last);
		if (['string', 'bool', 'enum'].includes(kind)) assert.equal(updateInlineKeyframe(input, definition, 'last', { interpolation: { type: 'linear' } }), null);
	}
});

// 【enumの選択肢変更後もキーを保持して修正できる】
// 古い型情報との不一致でエディタを閉じたり、別の選択肢へ勝手に置き換えたりしない。
// 空タイムラインからの追加だけは、最新の定義の有効な既定値を使う。
test('repairs enum keys using the current definition while preserving invalid stored values', () => {
	const oldDefinition = keyframeDefinition({ kind: 'enum', options: ['old', 'kept'] }, 'old');
	const definition = keyframeDefinition({ kind: 'enum', options: ['kept', 'new'] }, 'new');
	const input = createInlineKeyframesTimeline(oldDefinition);
	const id = input.keyframesTimeline.keyframes[0].id;
	assert.equal(canEditKeyframesTimeline(definition, input), true);
	const moved = updateInlineKeyframe(input, definition, id, { x: 100 });
	assert.equal(moved.keyframesTimeline.keyframes[0].value, 'old');
	assert.deepEqual(moved.keyframesTimeline.dataType, definition.dataType);
	assert.throws(() => updateInlineKeyframe(input, definition, id, { value: 'missing' }), /Invalid enum value/);
	const repaired = updateInlineKeyframe(input, definition, id, { value: 'new' });
	assert.equal(repaired.keyframesTimeline.keyframes[0].value, 'new');
	assert.equal(input.keyframesTimeline.keyframes[0].value, 'old');
	input.keyframesTimeline.keyframes = [];
	assert.equal(insertInlineKeyframe(input, definition, 0, 1000).value.keyframesTimeline.keyframes[0].value, 'new');
});

// 【離散値のタイムライン編集を履歴とプロジェクト保存へ統合する】
// 一文字ずつの編集の集約に使うCommandが、保存値を参照共有せずUndo/Redoで復元することを確認する。
// 通常のVisual ModuleとインラインVisual Moduleの両方で同じ入出力契約を維持する。
test('round-trips and undoes discrete keyframe creation insertion and editing on both module layer types', async () => {
	for (const inline of [false, true]) {
		for (const [dataType, first, second] of [[{ kind: 'string' }, 'Hello\n世界', ''], [{ kind: 'bool' }, true, false], [{ kind: 'enum', options: ['a', 'b'] }, 'a', 'b']]) {
			const { state } = fixture();
			const definition = { ...keyframeDefinition(dataType, first), id: 'gain', nameForReference: 'Gain' };
			state.visualModules.value[0].paramDefs = [definition];
			const layer = state.timelineScenes.value[0].layers[0];
			if (inline) { layer.layerType = 'inlineVisualModule'; layer.visualModule = state.visualModules.value[0]; delete layer.visualModuleId; }
			const target = { sceneId: 'scene', layerId: layer.id, paramPath: ['gain'] };
			const create = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
			create.execute(state);
			const initial = structuredClone(layer.visualModuleParamValues.gain);
			const inserted = insertInlineKeyframe(initial, definition, 10000, 20000);
			const value = updateInlineKeyframe(inserted.value, definition, inserted.keyframeId, { value: second });
			const edit = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, edit: { kind: 'keyframesTimelineInline', value } });
			edit.execute(state);
			const restored = decodeProjectFile(await encodeProjectFile({ assets: [], visualModules: state.visualModules.value, timelineScenes: state.timelineScenes.value }));
			assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
			value.keyframesTimeline.keyframes[0].value = 'mutated';
			edit.undo(state);
			assert.deepEqual(layer.visualModuleParamValues.gain, initial);
			create.undo(state);
			assert.equal(Object.hasOwn(layer.visualModuleParamValues, 'gain'), false);
			create.execute(state);
			edit.execute(state);
			assert.equal(layer.visualModuleParamValues.gain.keyframesTimeline.keyframes[0].value, first);
			assert.equal(layer.visualModuleParamValues.gain.keyframesTimeline.keyframes[1].value, second);
		}
	}
});

// 【イージングの系統と方向を編集し、Undo・Redo・保存で両方とも保持する】
// 補間方式を文字列だけとして扱う経路が残ると、再読み込み時などに方向の設定が失われる。
// 既存コマンドを通して変更し、選択したキー以外の設定や時刻を変更しないことも確認する。
test('round-trips easing family and direction and restores interpolation edits with undo and redo', async () => {
	const { state } = fixture();
	const definition = state.visualModules.value[0].paramDefs[0];
	const layer = state.timelineScenes.value[0].layers[0];
	const initial = createInlineKeyframesTimeline(definition);
	const keyframeId = initial.keyframesTimeline.keyframes[0].id;
	initial.keyframesTimeline.keyframes.push({ id: 'last', x: 1000, value: 10, interpolation: { type: 'hold' } });
	layer.visualModuleParamValues.gain = structuredClone(initial);
	const target = { sceneId: 'scene', layerId: layer.id, paramPath: ['gain'] };
	for (const interpolation of [{ type: 'ease:back', direction: 'inOut' }, { type: 'ease:elastic', direction: 'out' }, { type: 'linear' }, { type: 'hold' }]) {
		const before = structuredClone(layer.visualModuleParamValues.gain);
		const value = updateInlineKeyframe(before, definition, keyframeId, { interpolation });
		assert.notEqual(value, null);
		const edit = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, edit: { kind: 'keyframesTimelineInline', value } });
		edit.execute(state);
		assert.deepEqual(layer.visualModuleParamValues.gain.keyframesTimeline.keyframes[0].interpolation, interpolation);
		assert.deepEqual(layer.visualModuleParamValues.gain.keyframesTimeline.keyframes[1], initial.keyframesTimeline.keyframes[1]);
		const after = structuredClone(layer.visualModuleParamValues.gain);
		const restored = decodeProjectFile(await encodeProjectFile({ assets: [], visualModules: state.visualModules.value, timelineScenes: state.timelineScenes.value }));
		assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
		edit.undo(state);
		assert.deepEqual(layer.visualModuleParamValues.gain, before);
		edit.execute(state);
		assert.deepEqual(layer.visualModuleParamValues.gain, after);
	}
});

// 【キーの追加は挿入時刻のイージング後の値と、元の系統・方向を引き継ぐ】
// Linearとして値を求めると、イージング中の挿入位置で値が飛んでしまう。
// 元のBindingを変更せず、新しく区切った区間に同じプリセットを適用する。
test('inserts the eased value and inherits the outgoing easing family and direction', () => {
	const definition = keyframeDefinition({ kind: 'scalar' }, 0);
	const input = createInlineKeyframesTimeline(definition);
	input.keyframesTimeline.keyframes[0].interpolation = { type: 'ease:quad', direction: 'out' };
	input.keyframesTimeline.keyframes.push({ id: 'last', x: 1000, value: 8, interpolation: { type: 'hold' } });
	const before = structuredClone(input);
	const inserted = insertInlineKeyframe(input, definition, 500, 1000);
	const keyframe = inserted.value.keyframesTimeline.keyframes.find(point => point.id === inserted.keyframeId);
	assert.equal(keyframe.x, 500);
	assert.equal(keyframe.value, 6);
	assert.deepEqual(keyframe.interpolation, { type: 'ease:quad', direction: 'out' });
	assert.deepEqual(input, before);
});

// 【文字列・真理値・列挙値ではイージングを選択できない】
// 数値用の補間の種類が増えても、離散値のキーはその時刻で切り替えるという契約を維持する。
test('rejects easing interpolation for discrete keyframe values', () => {
	for (const [dataType, value] of [[{ kind: 'string' }, 'Hello'], [{ kind: 'bool' }, false], [{ kind: 'enum', options: ['a', 'b'] }, 'a']]) {
		const definition = keyframeDefinition(dataType, value);
		const input = createInlineKeyframesTimeline(definition);
		const before = structuredClone(input);
		assert.equal(updateInlineKeyframe(input, definition, input.keyframesTimeline.keyframes[0].id,
			{ interpolation: { type: 'ease:sine', direction: 'inOut' } }), null);
		assert.deepEqual(input, before);
	}
});

function imageFixture() {
	const assets = ['first', 'second'].map(id => ({ id, name: id, fileDataType: 'image/png', fileData: new Blob([id], { type: 'image/png' }) }));
	const state = { assets: { value: assets }, visualModules: { value: [] }, timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }] } };
	const layer = createImageLayer('first', 2000);
	const target = { sceneId: 'scene', layerId: layer.id, clipId: layer.clips[0].id };
	const add = COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer });
	add.execute(state);
	return { state, layer, target, add, current: () => state.timelineScenes.value[0].layers.find(entry => entry.id === layer.id) };
}

// 【画像の配置・合成設定・参照変更を保存とUndo/Redoで復元する】
// 静止画像の期間に素材長の制約を持ち込まず、画像の変更でもアニメーションと配置を維持する。
// BlobはAsset側だけに保存し、読み込み後にも同じIDで参照できることを確認する。
test('round-trips image assets and independently undoes timing, compositing and source edits', async () => {
	const { state, layer, target, add, current } = imageFixture();
	assert.equal(layer.clips[0].durationMs, 5000);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	assert.deepEqual(getLayerParameterTargets(layer), ['compositing']);
	const timing = COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'end', deltaMs: 55000 });
	const opacity = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	const source = COMMAND_DEFS.changeTimelineClipSource.create({ ...target, assetId: 'second' });
	for (const command of [timing, opacity, source]) command.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 0);
	assert.equal(current().clips[0].durationMs, 60000);
	assert.equal(current().compositingParamValues.opacity.inputSource, 'keyframesTimelineInline');
	const restored = decodeProjectFile(await encodeProjectFile({ assets: state.assets.value, timelineScenes: state.timelineScenes.value }));
	assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
	assert.equal(await restored.assets.find(asset => asset.id === current().clips[0].assetId).fileData.text(), 'second');
	for (const command of [source, opacity, timing]) command.undo(state);
	assert.deepEqual(current(), layer);
	add.undo(state);
	assert.equal(current(), undefined);
	add.execute(state);
	assert.deepEqual(current(), layer);
});

// 【画像レイヤーの複製は設定だけを独立させ、Asset削除後も参照IDを保持する】
// 画像を失ったレイヤーの期間やキーフレームを削除してしまうと、素材の復元や付け替えができない。
// 削除のUndoと、参照切れから別画像へ変更した操作のUndoをそれぞれ保証する。
test('preserves image references through asset deletion and keeps duplicated settings independent', async () => {
	const { state, layer, target, current } = imageFixture();
	const copy = { ...structuredClone(layer), id: 'copy' };
	COMMAND_DEFS.pasteTimelineLayer.create({ sceneId: 'scene', layer: copy, sourceLayerId: layer.id }).execute(state);
	COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.5 } }).execute(state);
	assert.equal(state.timelineScenes.value[0].layers.find(entry => entry.id === 'copy').compositingParamValues.opacity.value, 1);
	const remove = COMMAND_DEFS.removeAsset.create({ assetId: 'first' });
	remove.execute(state);
	assert.equal(current().clips[0].assetId, 'first');
	const restored = decodeProjectFile(await encodeProjectFile({ assets: state.assets.value, timelineScenes: state.timelineScenes.value }));
	assert.equal(restored.timelineScenes[0].layers.find(entry => entry.id === layer.id).clips[0].assetId, 'first');
	const change = COMMAND_DEFS.changeTimelineClipSource.create({ ...target, assetId: 'second' });
	change.execute(state);
	assert.equal(current().compositingParamValues.opacity.value, 0.5);
	change.undo(state);
	assert.equal(current().clips[0].assetId, 'first');
	remove.undo(state);
	assert.equal(await state.assets.value.find(asset => asset.id === current().clips[0].assetId).fileData.text(), 'first');
});

// 【画像以外のAssetや不正な期間を状態変更前に拒否する】
// UI以外からコマンドが呼ばれても、失敗した操作でUndo履歴に載らない部分変更を残さない。
test('rejects invalid image sources and timing without mutating layers', () => {
	const { state, layer, target } = imageFixture();
	state.assets.value.push({ id: 'video', fileDataType: 'video/mp4', fileData: new Blob() });
	const before = structuredClone(state.timelineScenes.value);
	for (const assetId of ['missing', 'video']) {
		assert.throws(() => COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer: { ...layer, id: 'invalid', clips: [{ ...layer.clips[0], assetId }] } }).execute(state), /Asset type does not match/);
		assert.throws(() => COMMAND_DEFS.changeTimelineClipSource.create({ ...target, assetId }).execute(state), /Asset type does not match/);
	}
	assert.throws(() => COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer: { ...layer, id: 'invalid', clips: [{ ...layer.clips[0], contentOffsetMs: -1 }] } }).execute(state), /Invalid clip timing/);
	assert.throws(() => COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'end', deltaMs: NaN }).execute(state), /Invalid trim/);
	assert.deepEqual(state.timelineScenes.value, before);
});

// 【動画レイヤーのトリム・映像・音声を保存と履歴で独立して復元する】
// 音声無効化が配置長や音量キーを変更しないこと、範囲外トリムが状態を壊さないことも確認する。
test('round-trips video settings and undoes trimmed timing and independent audio controls', async () => {
	const { state } = fixture();
	const layer = { id: 'video', layerType: 'video', name: 'Layer', clips: [{ id: 'clip', startMs: 10000, contentOffsetMs: 2000, durationMs: 5000, assetId: 'movie', audioEnabled: true }], compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	const target = { sceneId: 'scene', layerId: 'video', clipId: 'clip' };
	state.assets = { value: [{ id: 'movie', fileDataType: 'video/mp4', fileData: new Blob() }] };
	const add = COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer, sourceDurationsMs: { clip: 10000 } });
	add.execute(state);
	const settings = COMMAND_DEFS.editVideoClipAudio.create({ ...target, audioEnabled: false });
	const fit = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'compositing', paramPath: ['fitMode'], edit: { kind: 'literal', value: 'cover' } });
	const volume = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, target: 'audio', paramPath: ['volume'], edit: { kind: 'expression', value: 'TIME_MS / 1000' } });
	const timing = COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'end', deltaMs: 1000, sourceDurationMs: 10000 });
	for (const command of [settings, fit, volume, timing]) command.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video').compositingParamValues.fitMode, { inputSource: 'literal', value: 'cover' });
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const encoded = await encodeProjectFile({ gsVersion: '2.0.0', assets: [], timelineScenes: state.timelineScenes.value });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	assert.throws(() => COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'start', deltaMs: NaN, sourceDurationMs: 10000 }).execute(state), /Invalid trim/);
	assert.deepEqual(state.timelineScenes.value[0].layers, before);
	for (const command of [timing, volume, fit, settings]) command.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video'), layer);
	add.undo(state);
	add.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video'), layer);
});

// 【音声レイヤーの編集と保存を既存の履歴へ統合する】
// 音量Bindingと素材位置を別々にUndoでき、保存後もPlayerへの依存を持ち込まない。
test('round-trips audio layers and undoes timing, volume and removal', async () => {
	const { state } = fixture();
	const layer = { id: 'audio', layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 150, contentOffsetMs: 50, durationMs: 1000, assetId: 'sound' }],
		audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	state.assets = { value: [{ id: 'sound', fileDataType: 'audio/wav', fileData: new Blob() }] };
	const add = COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer, sourceDurationsMs: { clip: 2000 } });
	add.execute(state);
	const volume = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: 'audio', target: 'audio', paramPath: ['volume'], edit: { kind: 'expression', value: 'TIME_MS / 1000' } });
	volume.execute(state);
	const timing = COMMAND_DEFS.moveTimelineClips.create({ sceneId: 'scene', clips: [{ layerId: 'audio', clipId: 'clip' }], deltaMs: 100 });
	timing.execute(state);
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const remove = COMMAND_DEFS.removeTimelineLayer.create({ sceneId: 'scene', layerId: 'audio' });
	remove.execute(state);
	remove.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers, before);
	const encoded = await encodeProjectFile({ gsVersion: '2.0.0', assets: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: state.timelineScenes.value[0].layers }] });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	timing.undo(state);
	volume.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
	add.undo(state);
	assert.equal(state.timelineScenes.value[0].layers.some(entry => entry.id === 'audio'), false);
	add.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
});

// 合成設定の履歴はモジュールパラメータと独立し、保存された初期値まで復元する。
test('undoes and redoes compositing expressions without changing module parameters', () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	layer.visualModuleParamValues.opacity = { inputSource: 'literal', value: 0.8 };
	const command = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene',
		layerId: layer.id, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'expression', value: 'TIME_MS / 1000' },
	});
	command.execute(state);
	assert.deepEqual(layer.compositingParamValues.opacity, { inputSource: 'expression', expression: 'TIME_MS / 1000' });
	command.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	command.execute(state);
	assert.equal(layer.compositingParamValues.opacity.expression, 'TIME_MS / 1000');
	assert.equal(layer.visualModuleParamValues.opacity.value, 0.8);
});

// inlineグラフの編集データをコピーし、保存・読み込み後にも参照グラフや合成方法を保持する。
// プロジェクト保存はAssetのBlobをバイト列へ変換する非同期処理なので、素材がなくても完了を待つ。
// 保存前のオブジェクト比較だけでは、再読み込み時にグラフや合成設定が欠落する不具合を検出できない。
test('preserves compositing graphs and settings through edits and serialization', async () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	const edit = (paramId, edit) => {
		const command = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: layer.id, target: 'compositing', paramPath: [paramId], edit });
		command.execute(state);
		return command;
	};
	const input = createInlineAutomationGraph();
	input.automationGraph.points[0].y = 0.25;
	layer.automationGraphs.push({ id: 'graph', name: 'Layer graph', ...structuredClone(input.automationGraph) });
	const inline = edit('opacity', { kind: 'automationGraphInline', value: input });
	input.automationGraph.points[0].y = 99;
	assert.equal(layer.compositingParamValues.opacity.automationGraph.points[0].y, 0.25);
	inline.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	inline.execute(state);
	edit('rotation', { kind: 'automationGraphReference', value: 'graph', options: { trimmedDurationMs: 2500, offsetMode: 'start', wrapMode: 'clamp' } });
	edit('blendMode', { kind: 'literal', value: 'replace' });
	const restored = decodeProjectFile(await encodeProjectFile({ timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }], assets: [] })).timelineScenes[0].layers[0];
	assert.deepEqual(restored.compositingParamValues, layer.compositingParamValues);
	assert.deepEqual(restored.automationGraphs, layer.automationGraphs);
	assert.equal(restored.compositingParamValues.rotation.trimmedDurationMs, 2500);
	const reset = edit('blendMode', { kind: 'reset' });
	assert.equal(layer.compositingParamValues.blendMode.value, 'normal');
	reset.undo(state);
	assert.equal(layer.compositingParamValues.blendMode.value, 'replace');
});

// 単位切り替えはXと制御点のXだけを変換し、曲線の形・Y・元データを維持する。
test('converts inline graph coordinates between normalized and millisecond units', () => {
	const original = createInlineAutomationGraph();
	original.trimmedDurationMs = 2500;
	const ms = setInlineAutomationGraphNormalized(original, false);
	assert.equal(ms.automationGraph.isNormalized, false);
	assert.deepEqual(ms.automationGraph.points.map(point => point.x), [0, 2500]);
	assert.deepEqual(ms.automationGraph.points[0].bezierControlPointB, [1250, 0]);
	assert.deepEqual(ms.automationGraph.points[1].bezierControlPointA, [-1250, 0]);
	assert.deepEqual(setInlineAutomationGraphNormalized(ms, true), original);
	assert.deepEqual(original.automationGraph.points.map(point => point.x), [0, 1]);
	// msグラフの開始時刻が0以外でも、実際の区間を正規化する。
	for (const point of ms.automationGraph.points) point.x += 500;
	const normalized = setInlineAutomationGraphNormalized(ms, true);
	assert.equal(normalized.trimmedDurationMs, 2500);
	assert.deepEqual(normalized.automationGraph.points.map(point => point.x), [0, 1]);
});

// 空・1点のグラフから切り替えても、編集可能な固定端点と有限の座標を用意する。
test('provides normalized endpoints for empty and single-point inline graphs', () => {
	for (const empty of [true, false]) {
		const input = createInlineAutomationGraph();
		input.automationGraph.isNormalized = false;
		input.automationGraph.points = empty ? [] : [{ ...input.automationGraph.points[0], x: 300, y: 4 }];
		const result = setInlineAutomationGraphNormalized(input, true);
		assert.deepEqual(result.automationGraph.points.map(point => [point.x, point.y]), empty ? [[0, 0], [1, 0]] : [[0, 4], [1, 4]]);
	}
});

function fixture() {
	const initial = { inputSource: 'literal', value: 3 };
	const node = { id: 'node', type: 'effect', resolution: { mode: 'context' }, effectId: 'test', params: { values: { inputSource: 'literal', value: [{ id: 'first', binding: initial }] } } };
	const state = {
		visualModules: { value: [{ id: 'module', nodes: [node], primaryInputId: null, paramDefs: [{ ...keyframeDefinition({ kind: 'scalar' }, initial.value), id: 'gain' }] }] },
		timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'visualModule', visualModuleId: 'module', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], visualModuleParamValues: {}, compositingParamValues: defaultCompositing(), automationGraphs: [] }] }] },
	};
	return { state, node, target: { visualModuleId: 'module', nodeId: 'node', paramPath: ['values', 'first'] } };
}

// 【配列要素のBindingを切り替えても要素IDを維持する】
// inlineへの切り替えをUndoでき、RedoでグラフのポイントIDも再現する。
test('restores inline graph creation in nested node parameters', () => {
	const { state, node, target } = fixture();
	const command = COMMAND_DEFS.changeParamValueInputSource.create({ ...target, inputSource: 'automationGraphInline' });
	command.execute(state);
	const created = structuredClone(node.params.values.value[0].binding);
	assert.equal(node.params.values.value[0].id, 'first');
	assert.equal(created.inputSource, 'automationGraphInline');
	assert.equal(created.automationGraph.isNormalized, true);
	assert.deepEqual(created.automationGraph.points.map(point => point.x), [0, 1]);
	command.undo(state);
	assert.deepEqual(node.params.values.value[0], { id: 'first', binding: { inputSource: 'literal', value: 3 } });
	command.execute(state);
	assert.deepEqual(node.params.values.value[0], { id: 'first', binding: created });
});

// 【結合したドラッグ操作でも元の配列要素のBindingを復元する】
// AppContextは結合時に最初のundoと最後のexecuteを保持する。その契約で全ドラッグを復元できる。
test('restores the first and final snapshots of a merged graph drag', () => {
	const { state, node, target } = fixture();
	COMMAND_DEFS.changeParamValueInputSource.create({ ...target, inputSource: 'automationGraphInline' }).execute(state);
	const before = structuredClone(node.params.values.value[0].binding);
	const intermediate = structuredClone(before);
	intermediate.automationGraph.points[0].y = 2;
	const first = COMMAND_DEFS.updateParamAsAutomationGraphInline.create({ ...target, value: intermediate });
	first.execute(state);
	const final = structuredClone(intermediate);
	final.automationGraph.points[0].y = 4;
	final.automationGraph.points[1].bezierControlPointA = [-0.25, 2];
	const last = COMMAND_DEFS.updateParamAsAutomationGraphInline.create({ ...target, value: final });
	last.execute(state);
	// エディタが次に可変配列を編集しても、履歴のスナップショットは変わらない。
	intermediate.automationGraph.points[0].y = 99;
	node.params.values.value[0].binding.automationGraph.points[0].y = 100;
	first.undo(state);
	assert.deepEqual(node.params.values.value[0].binding, before);
	last.execute(state);
	assert.deepEqual(node.params.values.value[0].binding, final);
});

// レイヤーの設定変更もUndo/Redoでき、切り替え前の「既定値参照」へ戻せる。
test('undoes inline graph edits and creation on timeline layers', () => {
	const { state } = fixture();
	const target = { layerId: 'layer', paramPath: ['gain'] };
	const layer = state.timelineScenes.value[0].layers[0];
	const create = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', ...target, edit: { kind: 'inputSource', inputSource: 'automationGraphInline' } });
	create.execute(state);
	const before = structuredClone(layer.visualModuleParamValues.gain);
	const after = structuredClone(before);
	after.automationGraph.isNormalized = false;
	after.trimmedDurationMs = 2500;
	after.wrapMode = 'repeatMirrored';
	after.offsetMode = 'start';
	after.automationGraph.points[0].y = -2;
	const edit = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', ...target, edit: { kind: 'automationGraphInline', value: after } });
	edit.execute(state);
	assert.deepEqual(layer.visualModuleParamValues.gain, after);
	edit.undo(state);
	assert.deepEqual(layer.visualModuleParamValues.gain, before);
	create.undo(state);
	assert.equal(Object.hasOwn(layer.visualModuleParamValues, 'gain'), false);
	create.execute(state);
	edit.execute(state);
	assert.deepEqual(layer.visualModuleParamValues.gain, after);
});

// 【Sceneを切り替えてもレイヤー編集のUndoは元の定義へ戻る】
// 同じレイヤーIDが別Sceneに存在しても、編集対象をsceneIdと組み合わせて一意に指定する。
test('targets scene definitions explicitly across layer parameter undo and redo', () => {
	const { state } = fixture();
	const original = state.timelineScenes.value[0];
	const other = structuredClone(original);
	other.id = 'other';
	state.timelineScenes.value.push(other);
	const edit = COMMAND_DEFS.editTimelineLayerParam.create({ sceneId: 'scene', layerId: 'layer', target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.25 } });
	edit.execute(state);
	assert.equal(original.layers[0].compositingParamValues.opacity.value, 0.25);
	assert.equal(other.layers[0].compositingParamValues.opacity.value, 1);
	edit.undo(state);
	assert.equal(original.layers[0].compositingParamValues.opacity.value, 1);
	edit.execute(state);
	assert.equal(other.layers[0].compositingParamValues.opacity.value, 1);
});

// 【参照中Sceneの削除と循環する配置を状態変更前に拒否する】
// 失敗したCommandが部分的な変更を残すと、Undo履歴へ積まれない壊れた参照が保存されてしまう。
test('rejects referenced deletion and cyclic placement without mutating scenes', () => {
	const { state } = fixture();
	const nested = { id: 'nested', layerType: 'scene', name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000, sceneId: 'scene' }],
		compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, automationGraphs: [] };
	COMMAND_DEFS.addScene.create({ id: 'parent', name: 'Parent', resolution: { mode: 'project' }, layers: [nested] }).execute(state);
	const before = structuredClone(state.timelineScenes.value);
	assert.throws(() => COMMAND_DEFS.removeScene.create({ sceneId: 'scene' }).execute(state), /Scene is used by/);
	assert.throws(() => COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer: { ...nested, clips: [{ ...nested.clips[0], sceneId: 'parent' }] } }).execute(state), /circular scene reference/i);
	assert.deepEqual(state.timelineScenes.value, before);
	const remove = COMMAND_DEFS.removeScene.create({ sceneId: 'parent' });
	remove.execute(state);
	remove.undo(state);
	assert.deepEqual(state.timelineScenes.value, before);
});

// 【Sceneの解像度設定をUndo/Redoと保存で維持する】
// 配置ごとに設定を複製せず、参照先Sceneに保存する。不正値は変更前に拒否し、
// 履歴操作や保存の往復でもモードと基準寸法を失わない。
test('changes scene resolution with undo redo and project persistence', async () => {
	const { state } = imageFixture();
	const scene = state.timelineScenes.value[0];
	const resolution = { mode: 'customAbsolute', width: 513, height: 257 };
	const command = COMMAND_DEFS.changeSceneResolution.create({ sceneId: scene.id, resolution });
	command.execute(state);
	assert.deepEqual(scene.resolution, resolution);
	const restored = decodeProjectFile(await encodeProjectFile({ assets: state.assets.value, timelineScenes: state.timelineScenes.value }));
	assert.deepEqual(restored.timelineScenes[0].resolution, resolution);
	command.undo(state);
	assert.deepEqual(scene.resolution, { mode: 'project' });
	command.execute(state);
	assert.deepEqual(scene.resolution, resolution);
	assert.throws(() => COMMAND_DEFS.changeSceneResolution.create({ sceneId: scene.id, resolution: { mode: 'customAbsolute', width: 0, height: 1 } }).execute(state));
	assert.deepEqual(scene.resolution, resolution);
});

// 【生成系の左トリムは同一ドラッグ内で元に戻せ、確定後の左延長はしない】
// 各pointermoveで上限を再計算するとドラッグを引き返せなくなる。内容オフセットと右端を保ち、
// 操作を確定した後はUndoだけで元の区間を復元する。
test('reverses generated trims within a gesture and disallows subsequent left extension', () => {
	const { state, target, current } = imageFixture();
	const initialTiming = structuredClone(current().clips[0]);
	const first = COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'start', deltaMs: 500, initialTiming });
	first.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 500);
	const reverse = COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'start', deltaMs: 200, initialTiming });
	reverse.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 200);
	assert.equal(current().clips[0].startMs + current().clips[0].durationMs, 7000);
	COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'start', deltaMs: -100 }).execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 200);
	reverse.undo(state);
	first.undo(state);
	assert.deepEqual(current().clips[0], initialTiming);
});

// 【素材変更でトリムをリセットし、後続クリップを変更せず新素材を収める】
// 動画の音声設定・レイヤーのキーを維持し、Undoで元の参照と三つの時間情報をまとめて復元する。
test('resets a video source within its gap and restores it on undo', () => {
	const { state } = fixture();
	state.assets = { value: ['old', 'new'].map(id => ({ id, fileDataType: 'video/mp4', fileData: new Blob() })) };
	const layer = { id: 'video', name: 'Video', layerType: 'video', automationGraphs: [], compositingParamValues: defaultCompositing(),
		audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } }, clips: [
			{ id: 'a', assetId: 'old', audioEnabled: false, startMs: 100, durationMs: 100, contentOffsetMs: 50 },
			{ id: 'b', assetId: 'old', audioEnabled: true, startMs: 400, durationMs: 100, contentOffsetMs: 0 },
		] };
	COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer, sourceDurationsMs: { a: 1000, b: 1000 } }).execute(state);
	const current = state.timelineScenes.value[0].layers[0];
	const command = COMMAND_DEFS.changeTimelineClipSource.create({ sceneId: 'scene', layerId: 'video', clipId: 'a', assetId: 'new', sourceDurationMs: 1000 });
	command.execute(state);
	assert.deepEqual(current.clips[0], { id: 'a', assetId: 'new', audioEnabled: false, startMs: 100, durationMs: 300, contentOffsetMs: 0 });
	assert.deepEqual(current.clips[1], layer.clips[1]);
	command.undo(state);
	assert.deepEqual(current, layer);
});

function mediaFixture(layerType, contentOffsetMs = 0.25, durationMs = 5000) {
	const { state } = fixture();
	const asset = { id: 'media', fileDataType: layerType + '/test', fileData: new Blob(['original']), hash: 'original', width: 100, height: 100 };
	state.assets = { value: [asset] };
	const layer = { id: 'media-layer', name: 'Media', layerType, automationGraphs: [],
		...(layerType === 'video' ? { compositingParamValues: defaultCompositing() } : {}),
		audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } },
		clips: [{ id: 'clip', startMs: 100, durationMs, contentOffsetMs, assetId: asset.id, ...(layerType === 'video' ? { audioEnabled: true } : {}) }] };
	COMMAND_DEFS.addTimelineLayer.create({ sceneId: 'scene', layer, sourceDurationsMs: { clip: contentOffsetMs + durationMs } }).execute(state);
	return { state, asset, target: { sceneId: 'scene', layerId: layer.id, clipId: 'clip' }, current: state.timelineScenes.value[0].layers.find(entry => entry.id === layer.id) };
}

// 【Asset一覧で短い素材へ差し替えた後も、右トリムで区間を修復できる】
// 変更前の区間が素材長を超えていても、新しい区間が収まれば音声・動画とも受け付ける。
// 素材位置の小数とレイヤー設定を保持し、Undoでは差し替え後の元の区間へ戻す。
test('repairs oversized video and audio clips after replacing their assets', () => {
	for (const layerType of ['video', 'audio']) {
		const { state, asset, target, current } = mediaFixture(layerType);
		COMMAND_DEFS.replaceAsset.create({ ...asset, assetId: asset.id, fileData: new Blob(['shorter']), hash: 'shorter' }).execute(state);
		const before = structuredClone(current);
		const trim = COMMAND_DEFS.editTimelineClipTiming.create({ ...target,
			edge: 'end', deltaMs: -2999.6, sourceDurationMs: 2000.75 });
		trim.execute(state);
		assert.deepEqual(current, { ...before, clips: [{ ...before.clips[0], durationMs: 2000 }] });
		trim.undo(state);
		assert.deepEqual(current, before);
		trim.execute(state);
		assert.equal(current.clips[0].durationMs, 2000);
		assert.equal(current.clips[0].contentOffsetMs, 0.25);
	}
});

// 【小数オフセットを丸めずに整数msの左トリムを適用する】
// 0未満へ延長しない整数の下限で止め、表示終了と素材終端を維持する。
// 内容オフセットを0にスナップして動画・音声の開始位置を変えてはいけない。
test('preserves fractional offsets while trimming within integer placement bounds', () => {
	const { state, target, current: layer } = mediaFixture('video', 1.1);
	const before = structuredClone(layer.clips[0]);
	const trim = COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'start', deltaMs: -1.4, sourceDurationMs: 5001.1 });
	trim.execute(state);
	assert.equal(layer.clips[0].startMs, before.startMs - 1);
	assert.equal(layer.clips[0].durationMs, before.durationMs + 1);
	assert.equal(layer.clips[0].contentOffsetMs, before.contentOffsetMs - 1);
	assert.ok(layer.clips[0].contentOffsetMs > 0);
	trim.undo(state);
	assert.deepEqual(layer.clips[0], before);
});

// 【右トリムでも1msを確保できない素材位置は部分変更せず拒否する】
// 素材差し替えで内容の開始位置自体が素材終端を超えた場合、長さだけでは修復できない。
// 0長や負の長さにしてしまわず、参照変更など別の操作で直せる状態を保持する。
test('rejects an impossible media trim without changing the clip', () => {
	const { state, target, current } = mediaFixture('audio', 3000.25);
	const before = structuredClone(current);
	assert.throws(() => COMMAND_DEFS.editTimelineClipTiming.create({ ...target, edge: 'end', deltaMs: -4000, sourceDurationMs: 2000.75 }).execute(state), /No valid clip duration/);
	assert.deepEqual(current, before);
});

// 【素材参照の変更で小数の素材長を切り捨て、オフセットをリセットする】
// 四捨五入で素材を超えたり、素材長の小数を表示区間へ保存したりしないための確認。
test('floors a replacement media duration and restores the fractional offset on undo', () => {
	const { state, target, current: layer } = mediaFixture('video', 12.75);
	state.assets.value.push({ id: 'movie', fileDataType: 'video/mp4', fileData: new Blob() });
	const before = structuredClone(layer);
	const change = COMMAND_DEFS.changeTimelineClipSource.create({ ...target, assetId: 'movie', sourceDurationMs: 1234.75 });
	change.execute(state);
	assert.equal(layer.clips[0].durationMs, 1234);
	assert.equal(layer.clips[0].contentOffsetMs, 0);
	change.undo(state);
	assert.deepEqual(layer, before);
});
