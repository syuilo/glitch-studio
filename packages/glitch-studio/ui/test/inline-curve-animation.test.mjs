import { createDefaultParameterBinding } from '@gs/shared/parameter/parameter-default.ts';
import { testNodesEffect } from './helpers/nodes-effect.mjs';
import { nodeParameterTarget, assetSource } from './helpers/command-inputs.mjs';
import { prepareTestCommand } from './helpers/prepared-command.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// GPU・ストレージに依存する登録情報だけ差し替え、実際のコマンドとパラメータ解決を使う。
const bundled = await build({
	absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
	stdin: {
		contents: "export * from './src/utility/keyframes-timeline.ts'; export { timelineCompositingParamDefs } from '@gs/subsystems_timeline_shared/timeline-compositing.ts'; export { COMMAND_DEFS } from './src/commands.ts'; export { getTimelineParameterEditBinding } from './src/commands/timeline-parameter-api.ts'; export { createTimelineCommandDefinitions } from './src/commands/timeline-api.ts'; export { createInlineCurveAnimation, setInlineCurveAnimationXNormalized, setInlineCurveAnimationYNormalized } from './src/utility/curve-animation.ts'; export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts'; export { createImageLayer } from './src/utility/image-layer.ts'; export { getLayerParameterTargets } from './src/utility/timeline-scene.ts';",
		resolveDir: fileURLToPath(new URL('../', import.meta.url)),
		loader: 'ts',
	},
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{
		name: 'inline-curve-animation-test-dependencies',
		setup(build) {
			build.onResolve({ filter: /(?:effect-definitions|native-effects[\\/]definitions)\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'inline-curve-animation-test' }));
			build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'inline-curve-animation-test' }));
			build.onLoad({ filter: /.*/, namespace: 'inline-curve-animation-test' }, ({ path }) => ({
				contents: path === 'preferences'
					? 'export const preferences = { s: { forceTypeSafety: false } };'
					: `export const nativeEffectDefinitions = { test: { paramDefs: {
						values: { dataType: { kind: 'array', elementType: { kind: 'scalar' } }, ui: { label: 'Values', control: { element: { controlType: 'number' } } }, element: { defaultValue: 0 }, defaultValue: [] }
					} } };`,
				loader: 'ts',
			}));
		},
	}],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { timelineCompositingParamDefs, COMMAND_DEFS, createInlineCurveAnimation, setInlineCurveAnimationXNormalized, setInlineCurveAnimationYNormalized, encodeProjectFile, decodeProjectFile, createImageLayer, getLayerParameterTargets } = module.exports;

// UIイベントの変換も実際のBinding Commandを通し、履歴と保存値を検証する。
const uiParameterEdit = { prepare: (state, input) => COMMAND_DEFS.replaceTimelineLayerParameterBinding.prepare(state, module.exports.getTimelineParameterEditBinding(state, input)) };
// 既存レイヤーデータを必要とするfixtureは、採番を行う作成APIではなくインポート操作を使う。
const importLayer = { prepare: (state, input) => COMMAND_DEFS.insertTimelineAssetLayers.prepare(state, { sceneId: input.sceneId, layers: [input.layer], sourceDurationsMs: input.sourceDurationsMs ?? {} }) };
function mediaCommand(name, { sourceDurationMs, ...input }) {
 const definition = module.exports.createTimelineCommandDefinitions({ inspectMedia: () => ({ durationMs: sourceDurationMs, audioAvailable: true, audioError: null }) })[name];
 return prepareTestCommand(definition, input);
}

const defaultCompositing = () => Object.fromEntries(Object.entries(timelineCompositingParamDefs).map(([key, def]) => [key, createDefaultParameterBinding(def)]));
const { createInlineKeyframesTimeline, insertInlineKeyframe, updateInlineKeyframe, canEditKeyframesTimeline } = module.exports;

const keyframeDefinition = (dataType, value) => ({ dataType, defaultValue: value, ui: { label: 'Value', control: {} } });

// 【キー編集のPartial差分は、省略した項目を維持して指定した値を検証する】
// nullやundefinedの座標・補間を「変更なし」と扱ってからマージすると、無効なキーを保存してしまう。
// prototype上の項目も差分に含めず、valueだけの編集で既存の時刻と補間を維持する。
test('validates present keyframe fields without treating missing fields as updates', () => {
	const definition = keyframeDefinition({ kind: 'scalar' }, 1);
	const input = createInlineKeyframesTimeline(definition, { inputSource: 'literal', value: 1 });
	const keyframe = input.keyframesTimeline.keyframes[0];
	const updated = updateInlineKeyframe(input, definition, keyframe.id, { value: 2 });
	assert.equal(updated.keyframesTimeline.keyframes[0].x, keyframe.x);
	assert.deepEqual(updated.keyframesTimeline.keyframes[0].interpolation, keyframe.interpolation);
	for (const patch of [{ x: null }, { x: undefined }, { interpolation: null }, { interpolation: undefined }]) {
		assert.equal(updateInlineKeyframe(input, definition, keyframe.id, patch), null);
	}
	assert.equal(updateInlineKeyframe(input, definition, keyframe.id, Object.create({ x: -1 })), null);
	assert.equal(input.keyframesTimeline.keyframes[0].value, 1);
});

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
// 通常のNodes EffectとインラインNodes Effectの両方で同じ入出力契約を維持する。
test('round-trips and undoes discrete keyframe creation insertion and editing on both Nodes Effect layer types', async () => {
	for (const inline of [false, true]) {
		for (const [dataType, first, second] of [[{ kind: 'string' }, 'Hello\n世界', ''], [{ kind: 'bool' }, true, false], [{ kind: 'enum', options: ['a', 'b'] }, 'a', 'b']]) {
			const { state } = fixture();
			const definition = { ...keyframeDefinition(dataType, first), id: 'gain', nameForReference: 'gain' };
			state.nodesEffects.value[0].definition.paramDefs = { [definition.id]: definition };
			const layer = state.timelineScenes.value[0].layers[0];
			if (inline) { layer.effectSource = { type: 'inlineNodesEffect', nodesEffect: state.nodesEffects.value[0].definition }; }
			const target = { sceneId: 'scene', layerId: layer.id, paramPath: ['gain'] };
			const create = prepareTestCommand(uiParameterEdit, { ...target, edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
			create.execute(state);
			const initial = structuredClone(layer.effectParamValues.gain);
			const inserted = insertInlineKeyframe(initial, definition, 10000, 20000);
			const value = updateInlineKeyframe(inserted.value, definition, inserted.keyframeId, { value: second });
			const edit = prepareTestCommand(uiParameterEdit, { ...target, edit: { kind: 'keyframesTimelineInline', value } });
			edit.execute(state);
			const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: [], nodesEffects: state.nodesEffects.value, timelineScenes: state.timelineScenes.value }));
			assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
			value.keyframesTimeline.keyframes[0].value = 'mutated';
			edit.undo(state);
			assert.deepEqual(layer.effectParamValues.gain, initial);
			create.undo(state);
			assert.equal(Object.hasOwn(layer.effectParamValues, 'gain'), false);
			create.execute(state);
			edit.execute(state);
			assert.equal(layer.effectParamValues.gain.keyframesTimeline.keyframes[0].value, first);
			assert.equal(layer.effectParamValues.gain.keyframesTimeline.keyframes[1].value, second);
		}
	}
});

// 【イージングの系統と方向を編集し、Undo・Redo・保存で両方とも保持する】
// 補間方式を文字列だけとして扱う経路が残ると、再読み込み時などに方向の設定が失われる。
// 既存コマンドを通して変更し、選択したキー以外の設定や時刻を変更しないことも確認する。
test('round-trips easing family and direction and restores interpolation edits with undo and redo', async () => {
	const { state } = fixture();
	const definition = state.nodesEffects.value[0].definition.paramDefs.gain;
	const layer = state.timelineScenes.value[0].layers[0];
	const initial = createInlineKeyframesTimeline(definition);
	const keyframeId = initial.keyframesTimeline.keyframes[0].id;
	initial.keyframesTimeline.keyframes.push({ id: 'last', x: 1000, value: 10, interpolation: { type: 'hold' } });
	layer.effectParamValues.gain = structuredClone(initial);
	const target = { sceneId: 'scene', layerId: layer.id, paramPath: ['gain'] };
	for (const interpolation of [{ type: 'ease:back', direction: 'inOut' }, { type: 'ease:elastic', direction: 'out' }, { type: 'linear' }, { type: 'hold' }]) {
		const before = structuredClone(layer.effectParamValues.gain);
		const value = updateInlineKeyframe(before, definition, keyframeId, { interpolation });
		assert.notEqual(value, null);
		const edit = prepareTestCommand(uiParameterEdit, { ...target, edit: { kind: 'keyframesTimelineInline', value } });
		edit.execute(state);
		assert.deepEqual(layer.effectParamValues.gain.keyframesTimeline.keyframes[0].interpolation, interpolation);
		assert.deepEqual(layer.effectParamValues.gain.keyframesTimeline.keyframes[1], initial.keyframesTimeline.keyframes[1]);
		const after = structuredClone(layer.effectParamValues.gain);
		const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: [], nodesEffects: state.nodesEffects.value, timelineScenes: state.timelineScenes.value }));
		assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
		edit.undo(state);
		assert.deepEqual(layer.effectParamValues.gain, before);
		edit.execute(state);
		assert.deepEqual(layer.effectParamValues.gain, after);
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
	const state = { assets: { value: assets }, nodesEffects: { value: [] }, timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [] }] } };
	const layer = createImageLayer('first', 2000);
	const target = { sceneId: 'scene', layerId: layer.id, clipId: layer.clips[0].id };
	const add = prepareTestCommand(importLayer, { sceneId: 'scene', layer });
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
	assert.deepEqual(getLayerParameterTargets(layer), ['publicParameter', 'compositing']);
	const timing = prepareTestCommand(COMMAND_DEFS.trimTimelineClip, { ...target, edge: 'end', deltaMs: 55000 });
	const opacity = prepareTestCommand(uiParameterEdit, { ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } });
	const source = prepareTestCommand(COMMAND_DEFS.setTimelineClipSource, { ...target, assetId: 'second' });
	for (const command of [timing, opacity, source]) command.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 0);
	assert.equal(current().clips[0].durationMs, 60000);
	assert.equal(current().compositingParamValues.opacity.inputSource, 'keyframesTimelineInline');
	const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: state.assets.value, nodesEffects: [], timelineScenes: state.timelineScenes.value }));
	assert.deepEqual(restored.timelineScenes, state.timelineScenes.value);
	assert.equal(await restored.assets.find(asset => asset.id === current().clips[0].assetId).fileData.text(), 'second');
	for (const command of [source, opacity, timing]) command.undo(state);
	assert.deepEqual(current(), layer);
	add.undo(state);
	assert.equal(current(), undefined);
	add.execute(state);
	assert.deepEqual(current(), layer);
});

// 【参照マスクと通常合成からの除外をプロジェクトファイルへ保存する】
// UIの状態にだけ設定が残ると、開き直しや書き出しでマスク元の色が現れてしまう。
test('round-trips layer masks and reference-only layers through project files', async () => {
	const { state, target, current } = imageFixture();
	const source = createImageLayer('second', 2000);
	prepareTestCommand(importLayer, { sceneId: 'scene', layer: source }).execute(state);
	prepareTestCommand(COMMAND_DEFS.setTimelineLayerReferenceMask, { ...target, layerMask: { sourceLayerId: source.id, channel: 'luminance', inverted: true } }).execute(state);
	prepareTestCommand(COMMAND_DEFS.setTimelineLayerCompositeInclusion, { sceneId: 'scene', layerId: source.id, isIncludedInComposite: false }).execute(state);
	const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: state.assets.value, nodesEffects: [], timelineScenes: state.timelineScenes.value }));
	assert.deepEqual(restored.timelineScenes[0].layers.find(layer => layer.id === target.layerId).layerMask, current().layerMask);
	assert.equal(restored.timelineScenes[0].layers.find(layer => layer.id === source.id).isIncludedInComposite, false);
});

// 【画像レイヤーの複製は設定だけを独立させ、Asset削除後も参照IDを保持する】
// 画像を失ったレイヤーの期間やキーフレームを削除してしまうと、素材の復元や付け替えができない。
// 削除のUndoと、参照切れから別画像へ変更した操作のUndoをそれぞれ保証する。
test('preserves image references through asset deletion and keeps duplicated settings independent', async () => {
	const { state, layer, target, current } = imageFixture();
	const copy = { ...structuredClone(layer), id: 'copy' };
	const copyReference = prepareTestCommand(COMMAND_DEFS.insertTimelineLayer, { sceneId: 'scene', layer: copy, beforeLayerId: layer.id }).execute(state);
	copy.id = copyReference.layerId;
	prepareTestCommand(uiParameterEdit, { ...target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.5 } }).execute(state);
	assert.equal(state.timelineScenes.value[0].layers.find(entry => entry.id === copyReference.layerId).compositingParamValues.opacity.value, 1);
	const remove = prepareTestCommand(COMMAND_DEFS.removeAsset, { assetId: 'first' });
	remove.execute(state);
	assert.equal(current().clips[0].assetId, 'first');
	const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: state.assets.value, nodesEffects: [], timelineScenes: state.timelineScenes.value }));
	assert.equal(restored.timelineScenes[0].layers.find(entry => entry.id === layer.id).clips[0].assetId, 'first');
	const change = prepareTestCommand(COMMAND_DEFS.setTimelineClipSource, { ...target, assetId: 'second' });
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
		assert.throws(() => prepareTestCommand(importLayer, { sceneId: 'scene', layer: { ...layer, id: 'invalid', clips: [{ ...layer.clips[0], assetId }] } }).execute(state), /Asset type does not match/);
		assert.throws(() => prepareTestCommand(COMMAND_DEFS.setTimelineClipSource, { ...target, assetId }).execute(state), /Asset type does not match/);
	}
	assert.throws(() => prepareTestCommand(importLayer, { sceneId: 'scene', layer: { ...layer, id: 'invalid', clips: [{ ...layer.clips[0], contentOffsetMs: -1 }] } }).execute(state), /Invalid (clip timing|content offset)/);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.trimTimelineClip, { ...target, edge: 'end', deltaMs: NaN }).execute(state), /input: deltaMs:/);
	assert.deepEqual(state.timelineScenes.value, before);
});

// 【動画レイヤーのトリム・映像・音声を保存と履歴で独立して復元する】
// 音声無効化が配置長や音量キーを変更しないこと、範囲外トリムが状態を壊さないことも確認する。
test('round-trips video settings and undoes trimmed timing and independent audio controls', async () => {
	const { state } = fixture();
	const layer = { id: 'video', layerType: 'video', name: 'Layer', clips: [{ id: 'clip', startMs: 10000, sourceInMs: 2000, sourceOutMs: 7000, playbackRate: 1, loop: false, durationMs: 5000, assetId: 'movie', audioEnabled: true, videoEnabled: true }], compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, functionCurves: [] };
	const target = { sceneId: 'scene', layerId: 'video', clipId: 'clip' };
	state.assets = { value: [{ id: 'movie', fileDataType: 'video/mp4', fileData: new Blob() }] };
	const add = prepareTestCommand(importLayer, { sceneId: 'scene', layer, sourceDurationsMs: { [layer.id]: { clip: 10000 } } });
	add.execute(state);
	const settings = prepareTestCommand(COMMAND_DEFS.setTimelineVideoClipAudioEnabled, { ...target, audioEnabled: false });
	const fit = prepareTestCommand(uiParameterEdit, { ...target, target: 'compositing', paramPath: ['fitMode'], edit: { kind: 'literal', value: 'cover' } });
	const volume = prepareTestCommand(uiParameterEdit, { ...target, target: 'audio', paramPath: ['volume'], edit: { kind: 'expression', value: 'TIME_MS / 1000' } });
	const timing = mediaCommand('trimTimelineClip', { ...target, edge: 'end', deltaMs: 1000, sourceDurationMs: 10000 });
	for (const command of [settings, fit, volume, timing]) command.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'video').compositingParamValues.fitMode, { inputSource: 'literal', value: 'cover' });
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, gsVersion: '2.0.0', assets: [], nodesEffects: [], timelineScenes: state.timelineScenes.value });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	assert.throws(() => mediaCommand('trimTimelineClip', { ...target, edge: 'start', deltaMs: NaN, sourceDurationMs: 10000 }).execute(state), /input: deltaMs:/);
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
	const layer = { id: 'audio', layerType: 'audio', name: 'Layer', clips: [{ id: 'clip', startMs: 150, sourceInMs: 50, sourceOutMs: 1050, playbackRate: 1, loop: false, durationMs: 1000, assetId: 'sound' }],
		audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, functionCurves: [] };
	state.assets = { value: [{ id: 'sound', fileDataType: 'audio/wav', fileData: new Blob() }] };
	const add = prepareTestCommand(importLayer, { sceneId: 'scene', layer, sourceDurationsMs: { [layer.id]: { clip: 2000 } } });
	add.execute(state);
	const volume = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', layerId: 'audio', target: 'audio', paramPath: ['volume'], edit: { kind: 'expression', value: 'TIME_MS / 1000' } });
	volume.execute(state);
	const timing = prepareTestCommand(COMMAND_DEFS.moveTimelineClips, { sceneId: 'scene', clips: [{ layerId: 'audio', clipId: 'clip' }], deltaMs: 100 });
	timing.execute(state);
	const before = structuredClone(state.timelineScenes.value[0].layers);
	const remove = prepareTestCommand(COMMAND_DEFS.removeTimelineLayers, { sceneId: 'scene', layerIds: ['audio' ]});
	remove.execute(state);
	remove.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers, before);
	const encoded = await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, gsVersion: '2.0.0', assets: [], nodesEffects: [], timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: state.timelineScenes.value[0].layers }] });
	assert.deepEqual(decodeProjectFile(encoded).timelineScenes[0].layers, before);
	timing.undo(state);
	volume.undo(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
	add.undo(state);
	assert.equal(state.timelineScenes.value[0].layers.some(entry => entry.id === 'audio'), false);
	add.execute(state);
	assert.deepEqual(state.timelineScenes.value[0].layers.find(entry => entry.id === 'audio'), layer);
});

// 合成設定の履歴はNodes Effectパラメータと独立し、保存された初期値まで復元する。
test('undoes and redoes compositing expressions without changing Nodes Effect parameters', () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	layer.effectParamValues.opacity = { inputSource: 'literal', value: 0.8 };
	const command = prepareTestCommand(uiParameterEdit, { sceneId: 'scene',
		layerId: layer.id, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'expression', value: 'TIME_MS / 1000' },
	});
	command.execute(state);
	assert.deepEqual(layer.compositingParamValues.opacity, { inputSource: 'expression', expression: 'TIME_MS / 1000' });
	command.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	command.execute(state);
	assert.equal(layer.compositingParamValues.opacity.expression, 'TIME_MS / 1000');
	assert.equal(layer.effectParamValues.opacity.value, 0.8);
});

// インラインのCurve Animationの編集データをコピーし、保存・読み込み後にも参照Curve Animationや合成方法を保持する。
// プロジェクト保存はAssetのBlobをバイト列へ変換する非同期処理なので、素材がなくても完了を待つ。
// 保存前のオブジェクト比較だけでは、再読み込み時にCurve Animationや合成設定が欠落する不具合を検出できない。
test('preserves compositing Curve Animations and settings through edits and serialization', async () => {
	const { state } = fixture();
	const layer = state.timelineScenes.value[0].layers[0];
	const edit = (paramId, edit) => {
		const command = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', layerId: layer.id, target: 'compositing', paramPath: [paramId], edit });
		command.execute(state);
		return command;
	};
	const input = createInlineCurveAnimation();
	input.curveAnimation.curveBinding.curve.points[0].y = 0.25;
	layer.functionCurves.push({ id: 'curve-animation', nameForReference: 'layer_curve_animation', ...structuredClone(input.curveAnimation.curveBinding.curve) });
	const inline = edit('opacity', { kind: 'curveAnimationInline', value: input });
	input.curveAnimation.curveBinding.curve.points[0].y = 99;
	assert.equal(layer.compositingParamValues.opacity.curveAnimation.curveBinding.curve.points[0].y, 0.25);
	inline.undo(state);
	assert.deepEqual(layer.compositingParamValues, defaultCompositing());
	inline.execute(state);
	edit('rotation', { kind: 'curveAnimationInline', value: {
		inputSource: 'curveAnimationInline',
		curveAnimation: {
			curveBinding: { source: 'reference', curveId: 'curve-animation' },
			trimmedDurationMs: 2500, yRangeMin: 10, yRangeMax: 20, offsetMode: 'start', wrapMode: 'clamp',
		},
	} });
	edit('blendMode', { kind: 'literal', value: 'replace' });
	const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, timelineScenes: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }], assets: [], nodesEffects: [] })).timelineScenes[0].layers[0];
	assert.deepEqual(restored.compositingParamValues, layer.compositingParamValues);
	assert.deepEqual(restored.functionCurves, layer.functionCurves);
	assert.equal(restored.compositingParamValues.rotation.curveAnimation.trimmedDurationMs, 2500);
	const reset = edit('blendMode', { kind: 'reset' });
	assert.equal(layer.compositingParamValues.blendMode.value, 'normal');
	reset.undo(state);
	assert.equal(layer.compositingParamValues.blendMode.value, 'replace');
});

// 単位切り替えはXと制御点のXだけを変換し、曲線の形・Y・元データを維持する。
test('converts inline Curve Animation coordinates between normalized and millisecond units', () => {
	const original = createInlineCurveAnimation();
	original.curveAnimation.trimmedDurationMs = 2500;
	const ms = setInlineCurveAnimationXNormalized(original, false);
	assert.equal(ms.curveAnimation.curveBinding.curve.isXNormalized, false);
	assert.deepEqual(ms.curveAnimation.curveBinding.curve.points.map(point => point.x), [0, 2500]);
	assert.deepEqual(ms.curveAnimation.curveBinding.curve.points[0].bezierControlPointB, [1250, 0]);
	assert.deepEqual(ms.curveAnimation.curveBinding.curve.points[1].bezierControlPointA, [-1250, 0]);
	assert.deepEqual(setInlineCurveAnimationXNormalized(ms, true), original);
	assert.deepEqual(original.curveAnimation.curveBinding.curve.points.map(point => point.x), [0, 1]);
	// ミリ秒単位のCurve Animationの開始時刻が0以外でも、実際の区間を正規化する。
	for (const point of ms.curveAnimation.curveBinding.curve.points) point.x += 500;
	const normalized = setInlineCurveAnimationXNormalized(ms, true);
	assert.equal(normalized.curveAnimation.trimmedDurationMs, 2500);
	assert.deepEqual(normalized.curveAnimation.curveBinding.curve.points.map(point => point.x), [0, 1]);
});

// 空・1点のCurve Animationから切り替えても、編集可能な固定端点と有限の座標を用意する。
test('provides normalized endpoints for empty and single-point inline Curve Animations', () => {
	for (const empty of [true, false]) {
		const input = createInlineCurveAnimation();
		input.curveAnimation.curveBinding.curve.isXNormalized = false;
		input.curveAnimation.curveBinding.curve.points = empty ? [] : [{ ...input.curveAnimation.curveBinding.curve.points[0], x: 300, y: 4 }];
		const result = setInlineCurveAnimationXNormalized(input, true);
		assert.deepEqual(result.curveAnimation.curveBinding.curve.points.map(point => [point.x, point.y]), empty ? [[0, 0], [1, 0]] : [[0, 4], [1, 4]]);
	}
});

// 【インラインのY軸の切り替えで出力値とベジェの形を維持する】
// アンカーのYは端点に写し、相対ハンドルのYは幅だけで変換する。
test('converts inline Y coordinates and relative handles in both directions', () => {
	const original = createInlineCurveAnimation();
	original.curveAnimation.yRangeMin = 10;
	original.curveAnimation.yRangeMax = 18;
	const { curve } = original.curveAnimation.curveBinding;
	curve.points[0].y = -0.5;
	curve.points[0].bezierControlPointB[1] = 0.25;
	const raw = setInlineCurveAnimationYNormalized(original, false);
	const rawCurve = raw.curveAnimation.curveBinding.curve;
	assert.equal(rawCurve.isYNormalized, false);
	assert.deepEqual(rawCurve.points.map(point => point.y), [6, 18]);
	assert.deepEqual(rawCurve.points[0].bezierControlPointB, [0.5, 2]);
	assert.deepEqual(setInlineCurveAnimationYNormalized(raw, true), original);
});

function fixture() {
	const initial = { inputSource: 'literal', value: 3 };
	const node = { id: 'node', type: 'effect', resolution: { mode: 'context', scale: 1 }, staticSettings: {}, effectSource: { type: 'nativeEffect', id: 'test' }, params: { values: { inputSource: 'literal', value: [{ id: 'first', binding: initial }] } } };
	const state = {
		nodesEffects: { value: [{ id: 'nodesEffect', definition: testNodesEffect({ customParameterValues: {}, nodes: [node], primaryInputParameter: null, paramDefs: { "gain": { ...keyframeDefinition({ kind: 'scalar' }, initial.value) } } }) }] },
		timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [{ id: 'layer', layerType: 'effect', effectSource: { type: 'nodesEffectReference', id: 'nodesEffect' }, name: 'Layer', clips: [{ id: 'clip', startMs: 0, contentOffsetMs: 0, durationMs: 1000 }], effectParamValues: {}, compositingParamValues: defaultCompositing(), functionCurves: [] }] }] },
	};
	return { state, node, target: { nodesEffectId: 'nodesEffect', nodeId: 'node', paramPath: ['values', 'first'] } };
}

// 【配列要素のBindingを切り替えても要素IDを維持する】
// inlineへの切り替えをUndoでき、RedoでCurve AnimationのポイントIDも再現する。
test('restores inline Curve Animation creation in nested node parameters', () => {
	const { state, node, target } = fixture();
	const command = prepareTestCommand(COMMAND_DEFS.switchNodesEffectNodeParameterInputSource, { ...nodeParameterTarget({ ...target }), inputSource: 'curveAnimationInline' });
	command.execute(state);
	const created = structuredClone(node.params.values.value[0].binding);
	assert.equal(node.params.values.value[0].id, 'first');
	assert.equal(created.inputSource, 'curveAnimationInline');
	assert.equal(created.curveAnimation.curveBinding.curve.isXNormalized, true);
	assert.deepEqual(created.curveAnimation.curveBinding.curve.points.map(point => point.x), [0, 1]);
	command.undo(state);
	assert.deepEqual(node.params.values.value[0], { id: 'first', binding: { inputSource: 'literal', value: 3 } });
	command.execute(state);
	assert.deepEqual(node.params.values.value[0], { id: 'first', binding: created });
});

// 【結合したドラッグ操作でも元の配列要素のBindingを復元する】
// UndoRedoは結合時に最初のundoと最後のexecuteを保持する。その契約で全ドラッグを復元できる。
test('restores the first and final snapshots of a merged Curve Animation drag', () => {
	const { state, node, target } = fixture();
	prepareTestCommand(COMMAND_DEFS.switchNodesEffectNodeParameterInputSource, { ...nodeParameterTarget({ ...target }), inputSource: 'curveAnimationInline' }).execute(state);
	const before = structuredClone(node.params.values.value[0].binding);
	const intermediate = structuredClone(before);
	intermediate.curveAnimation.curveBinding.curve.points[0].y = 2;
	const first = prepareTestCommand(COMMAND_DEFS.setNodesEffectNodeParameterSource, { ...nodeParameterTarget({ ...target }), source: intermediate });
	first.execute(state);
	const final = structuredClone(intermediate);
	final.curveAnimation.curveBinding.curve.points[0].y = 4;
	final.curveAnimation.curveBinding.curve.points[1].bezierControlPointA = [-0.25, 2];
	const last = prepareTestCommand(COMMAND_DEFS.setNodesEffectNodeParameterSource, { ...nodeParameterTarget({ ...target }), source: final });
	last.execute(state);
	// エディタが次に可変配列を編集しても、履歴のスナップショットは変わらない。
	intermediate.curveAnimation.curveBinding.curve.points[0].y = 99;
	node.params.values.value[0].binding.curveAnimation.curveBinding.curve.points[0].y = 100;
	first.undo(state);
	assert.deepEqual(node.params.values.value[0].binding, before);
	last.execute(state);
	assert.deepEqual(node.params.values.value[0].binding, final);
});

// レイヤーの設定変更もUndo/Redoでき、切り替え前の「既定値参照」へ戻せる。
test('undoes inline Curve Animation edits and creation on timeline layers', () => {
	const { state } = fixture();
	const target = { layerId: 'layer', paramPath: ['gain'] };
	const layer = state.timelineScenes.value[0].layers[0];
	const create = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', ...target, edit: { kind: 'inputSource', inputSource: 'curveAnimationInline' } });
	create.execute(state);
	const before = structuredClone(layer.effectParamValues.gain);
	const after = structuredClone(before);
	after.curveAnimation.curveBinding.curve.isXNormalized = false;
	after.curveAnimation.trimmedDurationMs = 2500;
	after.curveAnimation.wrapMode = 'repeatMirrored';
	after.curveAnimation.offsetMode = 'start';
	after.curveAnimation.curveBinding.curve.points[0].y = -2;
	const edit = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', ...target, edit: { kind: 'curveAnimationInline', value: after } });
	edit.execute(state);
	assert.deepEqual(layer.effectParamValues.gain, after);
	edit.undo(state);
	assert.deepEqual(layer.effectParamValues.gain, before);
	create.undo(state);
	assert.equal(Object.hasOwn(layer.effectParamValues, 'gain'), false);
	create.execute(state);
	edit.execute(state);
	assert.deepEqual(layer.effectParamValues.gain, after);
});

// 【Sceneを切り替えてもレイヤー編集のUndoは元の定義へ戻る】
// 同じレイヤーIDが別Sceneに存在しても、編集対象をsceneIdと組み合わせて一意に指定する。
test('targets scene definitions explicitly across layer parameter undo and redo', () => {
	const { state } = fixture();
	const original = state.timelineScenes.value[0];
	const other = structuredClone(original);
	other.id = 'other';
	state.timelineScenes.value.push(other);
	const edit = prepareTestCommand(uiParameterEdit, { sceneId: 'scene', layerId: 'layer', target: 'compositing', paramPath: ['opacity'], edit: { kind: 'literal', value: 0.25 } });
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
		compositingParamValues: defaultCompositing(), audioParamValues: { volume: { inputSource: 'literal', value: 1 } }, functionCurves: [] };
	const parent = prepareTestCommand(COMMAND_DEFS.createTimelineScene, { name: 'Parent' }).execute(state);
	prepareTestCommand(importLayer, { sceneId: parent.sceneId, layer: nested }).execute(state);
	const before = structuredClone(state.timelineScenes.value);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.removeTimelineScene, { sceneId: 'scene' }).execute(state), /Scene is used by/);
	assert.throws(() => prepareTestCommand(importLayer, { sceneId: 'scene', layer: { ...nested, clips: [{ ...nested.clips[0], sceneId: parent.sceneId }] } }).execute(state), /circular scene reference/i);
	assert.deepEqual(state.timelineScenes.value, before);
	const remove = prepareTestCommand(COMMAND_DEFS.removeTimelineScene, { sceneId: parent.sceneId });
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
	const command = prepareTestCommand(COMMAND_DEFS.setTimelineSceneResolution, { sceneId: scene.id, resolution });
	command.execute(state);
	assert.deepEqual(scene.resolution, resolution);
	const restored = decodeProjectFile(await encodeProjectFile({ generatedSpeech: [], timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, assets: state.assets.value, nodesEffects: [], timelineScenes: state.timelineScenes.value }));
	assert.deepEqual(restored.timelineScenes[0].resolution, resolution);
	command.undo(state);
	assert.deepEqual(scene.resolution, { mode: 'project' });
	command.execute(state);
	assert.deepEqual(scene.resolution, resolution);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.setTimelineSceneResolution, { sceneId: scene.id, resolution: { mode: 'customAbsolute', width: 0, height: 1 } }).execute(state));
	assert.deepEqual(scene.resolution, resolution);
});

// 【生成系の左トリムは同一ドラッグ内で元に戻せ、確定後の左延長はしない】
// 各pointermoveで上限を再計算するとドラッグを引き返せなくなる。内容オフセットと右端を保ち、
// 操作を確定した後はUndoだけで元の区間を復元する。
test('reverses generated trims within a gesture and disallows subsequent left extension', () => {
	const { state, target, current } = imageFixture();
	const initialTiming = structuredClone(current().clips[0]);
	const first = prepareTestCommand(COMMAND_DEFS.replaceTimelineClipTiming, { ...target, timing: { ...initialTiming, startMs: initialTiming.startMs + 500, durationMs: initialTiming.durationMs - 500, contentOffsetMs: 500 } });
	first.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 500);
	const reverse = prepareTestCommand(COMMAND_DEFS.replaceTimelineClipTiming, { ...target, timing: { ...initialTiming, startMs: initialTiming.startMs + 200, durationMs: initialTiming.durationMs - 200, contentOffsetMs: 200 } });
	reverse.execute(state);
	assert.equal(current().clips[0].contentOffsetMs, 200);
	assert.equal(current().clips[0].startMs + current().clips[0].durationMs, 7000);
	assert.throws(() => prepareTestCommand(COMMAND_DEFS.trimTimelineClip, { ...target, edge: 'start', deltaMs: -100 }).execute(state), /outside the valid range/);
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
	const layer = { id: 'video', name: 'Video', layerType: 'video', functionCurves: [], compositingParamValues: defaultCompositing(),
		audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } }, clips: [
			{ id: 'a', assetId: 'old', audioEnabled: false, videoEnabled: true, startMs: 100, durationMs: 100, sourceInMs: 50, sourceOutMs: 150, playbackRate: 1, loop: false },
			{ id: 'b', assetId: 'old', audioEnabled: true, videoEnabled: true, startMs: 400, durationMs: 100, sourceInMs: 0, sourceOutMs: 100, playbackRate: 1, loop: false },
		] };
	prepareTestCommand(importLayer, { sceneId: 'scene', layer, sourceDurationsMs: { [layer.id]: { a: 1000, b: 1000 } } }).execute(state);
	const current = state.timelineScenes.value[0].layers[0];
	const command = mediaCommand('setTimelineClipSource', { sceneId: 'scene', layerId: 'video', clipId: 'a', assetId: 'new', sourceDurationMs: 1000 });
	command.execute(state);
	assert.deepEqual(current.clips[0], { id: 'a', assetId: 'new', audioEnabled: false, videoEnabled: true, startMs: 100, durationMs: 300, sourceInMs: 0, sourceOutMs: 300, playbackRate: 1, loop: false });
	assert.deepEqual(current.clips[1], layer.clips[1]);
	command.undo(state);
	assert.deepEqual(current, layer);
});

function mediaFixture(layerType, contentOffsetMs = 0.25, durationMs = 5000) {
	const { state } = fixture();
	const asset = { id: 'media', fileDataType: layerType + '/test', fileData: new Blob(['original']), hash: 'original', width: 100, height: 100 };
	state.assets = { value: [asset] };
	const layer = { id: 'media-layer', name: 'Media', layerType, functionCurves: [],
		...(layerType === 'video' ? { compositingParamValues: defaultCompositing() } : {}),
		audioParamValues: { volume: { inputSource: 'literal', value: 0.5 } },
		clips: [{ id: 'clip', startMs: 100, durationMs, sourceInMs: contentOffsetMs, sourceOutMs: contentOffsetMs + durationMs, playbackRate: 1, loop: false, assetId: asset.id, ...(layerType === 'video' ? { audioEnabled: true, videoEnabled: true } : {}) }] };
	prepareTestCommand(importLayer, { sceneId: 'scene', layer, sourceDurationsMs: { [layer.id]: { clip: contentOffsetMs + durationMs } } }).execute(state);
	return { state, asset, target: { sceneId: 'scene', layerId: layer.id, clipId: 'clip' }, current: state.timelineScenes.value[0].layers.find(entry => entry.id === layer.id) };
}

// 【Asset一覧で短い素材へ差し替えた後も、右トリムで区間を修復できる】
// 変更前の区間が素材長を超えていても、新しい区間が収まれば音声・動画とも受け付ける。
// 素材位置の小数とレイヤー設定を保持し、Undoでは差し替え後の元の区間へ戻す。
test('repairs oversized video and audio clips after replacing their assets', () => {
	for (const layerType of ['video', 'audio']) {
		const { state, asset, target, current } = mediaFixture(layerType);
		prepareTestCommand(COMMAND_DEFS.replaceAssetSource, { assetId: asset.id, source: assetSource({ ...asset, fileData: new Blob(['shorter']), hash: 'shorter' }) }).execute(state);
		const before = structuredClone(current);
		const trim = mediaCommand('trimTimelineClip', { ...target,
			edge: 'end', deltaMs: -3000, sourceDurationMs: 2000.75 });
		trim.execute(state);
		assert.deepEqual(current, { ...before, clips: [{ ...before.clips[0], durationMs: 2000, sourceOutMs: before.clips[0].sourceInMs + 2000 }] });
		trim.undo(state);
		assert.deepEqual(current, before);
		trim.execute(state);
		assert.equal(current.clips[0].durationMs, 2000);
		assert.equal(current.clips[0].sourceInMs, 0.25);
	}
});

// 【小数オフセットを丸めずに整数msの左トリムを適用する】
// 0未満へ延長しない整数の下限で止め、表示終了と素材終端を維持する。
// 内容オフセットを0にスナップして動画・音声の開始位置を変えてはいけない。
test('preserves fractional offsets while trimming within integer placement bounds', () => {
	const { state, target, current: layer } = mediaFixture('video', 1.1);
	const before = structuredClone(layer.clips[0]);
	const trim = mediaCommand('trimTimelineClip', { ...target, edge: 'start', deltaMs: -1, sourceDurationMs: 5001.1 });
	trim.execute(state);
	assert.equal(layer.clips[0].startMs, before.startMs - 1);
	assert.equal(layer.clips[0].durationMs, before.durationMs + 1);
	assert.equal(layer.clips[0].sourceInMs, before.sourceInMs - 1);
	assert.ok(layer.clips[0].sourceInMs > 0);
	trim.undo(state);
	assert.deepEqual(layer.clips[0], before);
});

// 【右トリムでも1msを確保できない素材位置は部分変更せず拒否する】
// 素材差し替えで内容の開始位置自体が素材終端を超えた場合、長さだけでは修復できない。
// 0長や負の長さにしてしまわず、参照変更など別の操作で直せる状態を保持する。
test('rejects an impossible media trim without changing the clip', () => {
	const { state, target, current } = mediaFixture('audio', 3000.25);
	const before = structuredClone(current);
	assert.throws(() => mediaCommand('trimTimelineClip', { ...target, edge: 'end', deltaMs: -4000, sourceDurationMs: 2000.75 }).execute(state), /No valid clip duration/);
	assert.deepEqual(current, before);
});

// 【素材参照の変更で小数の素材長を切り捨て、オフセットをリセットする】
// 四捨五入で素材を超えたり、素材長の小数を表示区間へ保存したりしないための確認。
test('floors a replacement media duration and restores the fractional offset on undo', () => {
	const { state, target, current: layer } = mediaFixture('video', 12.75);
	state.assets.value.push({ id: 'movie', fileDataType: 'video/mp4', fileData: new Blob() });
	const before = structuredClone(layer);
	const change = mediaCommand('setTimelineClipSource', { ...target, assetId: 'movie', sourceDurationMs: 1234.75 });
	change.execute(state);
	assert.equal(layer.clips[0].durationMs, 1234);
	assert.equal(layer.clips[0].sourceInMs, 0);
	change.undo(state);
	assert.deepEqual(layer, before);
});
