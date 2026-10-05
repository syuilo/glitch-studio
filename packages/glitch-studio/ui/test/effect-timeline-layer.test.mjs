import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const uiDirectory = fileURLToPath(new URL('../', import.meta.url));
const effectNames = (await readdir(new URL(import.meta.resolve('@gs/subsystems_effect_shared/fx/'))))
	.filter(name => existsSync(new URL(import.meta.resolve(`@gs/subsystems_effect_shared/fx/${name}/_def_.ts`))));
const bundled = await build({
	absWorkingDir: uiDirectory,
	stdin: { contents: `
		export { COMMAND_DEFS } from './src/commands.ts';
		export { createEffectTimelineLayer } from './src/utility/effect-timeline-layer.ts';
		export { resolveLayerParameter, getLayerKeyframeParameters } from './src/utility/timeline-scene.ts';
		export { encodeProjectFile, decodeProjectFile } from './src/gsproj.ts';
		export { canConnectNodeDataTypes } from './src/utility/node-outputs.ts';
		export { areNodeDataTypesCompatible } from '@gs/shared/data-type/node-compatibility.ts';
		export { effectDefinitions } from '@gs/subsystems_effect_shared/effect-definitions.ts';
		export { preferences } from './src/preferences.ts';
		export { validateTimelineEffectLayer } from '@gs/subsystems_timeline_shared/effect-layer.ts';
	`, resolveDir: uiDirectory, loader: 'ts' },
	bundle: true, platform: 'node', format: 'cjs', write: false,
	plugins: [{ name: 'effect-layer-test', setup(build) {
		build.onResolve({ filter: /effect-definitions\.[jt]s$/ }, () => ({ path: 'effects', namespace: 'test' }));
		build.onResolve({ filter: /preferences\.ts$/ }, () => ({ path: 'preferences', namespace: 'test' }));
		build.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({
			loader: 'ts', resolveDir: uiDirectory,
			contents: path === 'preferences' ? 'export const preferences = { s: { forceTypeSafety: false } };'
				: effectNames.map((name, index) => `import effect${index} from '@gs/subsystems_effect_shared/fx/${name}/_def_.ts';`).join('\n')
				+ `\nexport const effectDefinitions = Object.fromEntries([${effectNames.map((_, index) => `effect${index}`).join(',')}].map(def => [def.id, def]));`,
		}));
	} }],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { COMMAND_DEFS, createEffectTimelineLayer, resolveLayerParameter, getLayerKeyframeParameters, effectDefinitions, preferences,
	canConnectNodeDataTypes, areNodeDataTypesCompatible, encodeProjectFile, decodeProjectFile, validateTimelineEffectLayer } = module.exports;
const literal = value => ({ inputSource: 'literal', value });

// 【Playerの音声指定はGlitch StudioのCommand境界で検証する】
// 共通パラメータの検証から取得元の種類を取り除いても、保存されるPlayer指定の制約は維持する。
// 公開パラメータ参照の扱いはVisual Module側に残し、異なる取得元の指定を混入させない。
test('validates player audio selections at the application command boundary', () => {
	const audio = { ...effectDefinitions.audioWaveform.paramDefs.audio, id: 'sound', nameForReference: 'Sound' };
	const node = { id: 'waveform', type: 'effect', effectId: 'audioWaveform', params: { audio: literal(null) } };
	const state = { visualModules: { value: [{ id: 'visual', paramDefs: [audio], nodes: [node] }] } };
	const target = { visualModuleId: 'visual', nodeId: node.id, paramPath: ['audio'] };
	const command = value => COMMAND_DEFS.updateParamAsLiteral.create({ ...target, value });
	const selection = { type: 'player', playerId: 'player' };
	const edit = command(selection);
	edit.execute(state);
	assert.deepEqual(node.params.audio, literal(selection));
	for (const invalid of [{ type: 'player', playerId: '' }, { type: 'layer', layerId: 'audio' }, 'player']) {
		assert.throws(() => command(invalid).execute(state), /Invalid player audio source/);
		assert.deepEqual(node.params.audio, literal(selection));
	}
	edit.undo(state);
	assert.deepEqual(node.params.audio, literal(null));
	COMMAND_DEFS.updateParamAsExternalCustomParameterInput.create({ ...target, value: audio.id }).execute(state);
	assert.equal(node.params.audio.parameterId, audio.id);
	assert.throws(() => COMMAND_DEFS.updateParamAsExpression.create({ ...target, value: 'null' }).execute(state), /static input/);
});

// 【波形レイヤーは主音声入力を下層へ割り当て、リセットとUndo/Redoでも復元する】
// 音声の主入力を画像の主入力とは別に扱い、生成系の通常合成を維持する。
// 未選択を明示した状態も保存し、自動入力によって勝手に上書きしない。
test('defaults waveform audio to lower layers and restores overrides through undo and redo', () => {
	const f = fixture('audioWaveform');
	assert.deepEqual(f.read(['audio']), { inputSource: 'lowerLayerAudio' });
	assert.deepEqual(f.layer.compositingParamValues.blendMode, literal('normal'));
	f.edit(['audio'], { kind: 'literal', value: null });
	const reset = f.edit(['audio'], { kind: 'reset' });
	assert.equal(f.read(['audio']).inputSource, 'lowerLayerAudio');
	reset.undo(f.state);
	assert.deepEqual(f.read(['audio']), literal(null));
	reset.execute(f.state);
	assert.equal(f.read(['audio']).inputSource, 'lowerLayerAudio');
	assert.deepEqual(effectDefinitions.audioWaveform.paramDefs.audio.defaultValue, literal(null));
	for (const edit of [
		{ kind: 'literal', value: { type: 'player', playerId: 'player' } },
		{ kind: 'inputSource', inputSource: 'expression' },
		{ kind: 'inputSource', inputSource: 'keyframesTimelineInline' },
		{ kind: 'inputSource', inputSource: 'layerInput' },
	]) assert.throws(() => f.edit(['audio'], edit));
	assert.throws(() => f.edit(['amplitude'], { kind: 'inputSource', inputSource: 'lowerLayerAudio' }));
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
			element: { fields: { source: { defaultValue: literal(null), canNode: false } }, defaultValue: literal({ source: literal(null) }) },
			defaultValue: literal([{ id: 'first', binding: literal({ source: literal(null) }) }]) },
	} };
	t.after(() => { delete effectDefinitions.nestedAudio; });
	const f = fixture('nestedAudio');
	const path = ['inputs', 'first', 'source'];
	f.edit(path, { kind: 'inputSource', inputSource: 'lowerLayerAudio' });
	assert.equal(f.read(path).inputSource, 'lowerLayerAudio');
	const reset = f.edit(path, { kind: 'reset' });
	assert.deepEqual(f.read(path), literal(null));
	reset.undo(f.state);
	assert.equal(f.read(path).inputSource, 'lowerLayerAudio');
	assert.throws(() => f.edit(path, { kind: 'expression', value: 'null' }));
	assert.throws(() => f.edit(['inputs'], { kind: 'literal', value: [{ id: 'first', binding: literal({ source: literal({ type: 'player', playerId: 'x' }) }) }] }));
});

// 【公開音声入力の指定と引数の既定値を保存し、定義編集とUndoで対応を維持する】
// 主音声入力のメタデータはVisual Moduleが所有し、エフェクト定義やパラメータ自体へ役割を混ぜない。
// 音声型からの変更・削除で参照を解除し、Undoでは元のIDと設定を復元する。
test('edits primary audio parameters and timeline arguments with independent undo history', () => {
	const f = fixture('audioWaveform');
	const audio = { ...effectDefinitions.audioWaveform.paramDefs.audio, id: 'sound', nameForReference: 'Sound' };
	const visualModule = { id: 'visual', nodes: [], outputDefs: [], primaryOutputId: null, primaryInputId: null, primaryAudioInputId: null,
		paramDefs: [audio], automationGraphs: [] };
	f.state.visualModules.value.push(visualModule);
	const command = (name, payload) => COMMAND_DEFS[name].create({ visualModuleId: visualModule.id, ...payload });
	const primary = command('setVisualModulePrimaryAudioInput', { primaryAudioInputId: 'sound' });
	primary.execute(f.state);
	assert.equal(visualModule.primaryAudioInputId, 'sound');
	primary.undo(f.state);
	assert.equal(visualModule.primaryAudioInputId, null);
	primary.execute(f.state);
	assert.throws(() => command('setVisualModulePrimaryAudioInput', { primaryAudioInputId: 'missing' }).execute(f.state));
	const layer = { ...f.layer, layerType: 'visualModule', visualModuleId: 'visual', visualModuleParamValues: {} };
	f.state.timelineScenes.value[0].layers = [layer];
	assert.deepEqual(resolveLayerParameter(f.state, layer, 'module', ['sound']).value, { inputSource: 'lowerLayerAudio' });
	const none = COMMAND_DEFS.editTimelineLayerParam.create({ ...f.target, target: 'module', paramPath: ['sound'], edit: { kind: 'literal', value: null } });
	none.execute(f.state);
	assert.deepEqual(layer.visualModuleParamValues.sound, literal(null));
	const reset = COMMAND_DEFS.editTimelineLayerParam.create({ ...f.target, target: 'module', paramPath: ['sound'], edit: { kind: 'reset' } });
	reset.execute(f.state);
	assert.deepEqual(layer.visualModuleParamValues.sound, { inputSource: 'lowerLayerAudio' });
	reset.undo(f.state);
	assert.deepEqual(layer.visualModuleParamValues.sound, literal(null));
	none.undo(f.state);
	assert.equal(Object.hasOwn(layer.visualModuleParamValues, 'sound'), false);
	for (const [name, payload] of [
		['removeVisualModuleParamDef', { defId: 'sound' }],
		['updateVisualModuleParamDef', { defId: 'sound', changes: { dataType: { kind: 'scalar' }, ui: { label: 'Value', control: { controlType: 'number' } }, defaultValue: literal(0) } }],
	]) {
		const edit = command(name, payload);
		edit.execute(f.state);
		assert.equal(visualModule.primaryAudioInputId, null);
		edit.undo(f.state);
		assert.equal(visualModule.primaryAudioInputId, 'sound');
		assert.equal(visualModule.paramDefs[0].dataType.kind, 'audioSource');
	}
	assert.throws(() => command('updateVisualModuleParamDef', { defId: 'sound', changes: { canNode: true } }).execute(f.state));
});

// 【すべてのエフェクトを既定値のままレイヤーとして作成できる】
// タイムライン向けの候補制限は設けないため、配列・構造体の既定値もレイヤーのBinding制約に従う必要がある。
test('creates every bundled effect without illegal binding defaults', () => {
	for (const definition of Object.values(effectDefinitions)) {
		assert.ok(['generate', 'modify'].includes(definition.kind), definition.id);
		validateTimelineEffectLayer(createEffectTimelineLayer(definition, 0), definition);
	}
});

function fixture(effectId = 'testStructArray') {
	const layer = createEffectTimelineLayer(effectDefinitions[effectId], 100);
	const state = { timelineScenes: { value: [{ id: 'scene', name: 'Scene', resolution: { mode: 'project' }, layers: [layer] }] }, visualModules: { value: [] }, assets: { value: [] } };
	const target = { sceneId: 'scene', layerId: layer.id, target: 'effect' };
	const edit = (paramPath, edit) => {
		const command = COMMAND_DEFS.editTimelineLayerParam.create({ ...target, paramPath, edit });
		command.execute(state);
		return command;
	};
	return { layer, state, target, edit, read: path => resolveLayerParameter(state, layer, 'effect', path).value };
}

// 【キーの行名は所有者を区別し、配列の並び替え後も同じIDを指す】
// エフェクトと合成設定が同じ表示名を持っても、どちらを編集する行か分かるようにする。
// 配列のindexは表示だけに使い、並び替えで選択キーや参照先のIDを変更しない。
test('labels keyframe rows by owner and current array order while preserving path identity', t => {
	effectDefinitions.labelProbe = { ...effectDefinitions.testStructArray, id: 'labelProbe', paramDefs: {
		...effectDefinitions.testStructArray.paramDefs,
		opacity: { dataType: { kind: 'scalar' }, ui: { label: 'Opacity', control: { controlType: 'number' } }, defaultValue: literal(1) },
	} };
	t.after(() => { delete effectDefinitions.labelProbe; });
	const f = fixture('labelProbe');
	f.edit(['opacity'], { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	COMMAND_DEFS.editTimelineLayerParam.create({ ...f.target, target: 'compositing', paramPath: ['opacity'],
		edit: { kind: 'inputSource', inputSource: 'keyframesTimelineInline' } }).execute(f.state);
	const path = ['buzzs', 'first', 'x'];
	f.edit(path, { kind: 'inputSource', inputSource: 'keyframesTimelineInline' });
	const rows = getLayerKeyframeParameters(f.state, f.layer);
	assert.deepEqual(rows.map(row => row.label), ['Compositing / Opacity', 'Effect / Buzzs [0] / X', 'Effect / Opacity']);
	const original = rows.find(row => row.paramPath.length > 1);
	f.edit(['buzzs'], { kind: 'addElement' });
	f.read(['buzzs']).value.reverse();
	const moved = getLayerKeyframeParameters(f.state, f.layer).find(row => row.key === original.key);
	assert.deepEqual(moved.paramPath, path);
	assert.deepEqual(moved.binding, original.binding);
	assert.equal(moved.label, 'Effect / Buzzs [1] / X');
});

// 【主入力がある生成系と加工系で初期入力・合成を分ける】
// 背景入力の存在だけでGridを加工系にすると背景を二重に合成してしまう。
// リセットはレイヤーとしての初期入力に戻し、共有するエフェクト定義を変更しない。
test('initializes kinds independently of primary input presence and resets the layer input', () => {
	const generated = fixture('grid');
	assert.deepEqual(generated.layer.effectParamValues.background, effectDefinitions.grid.paramDefs.background.defaultValue);
	assert.deepEqual(generated.layer.compositingParamValues.blendMode, literal('normal'));
	const modified = fixture('colorMix');
	assert.deepEqual(modified.read(['inputA']), { inputSource: 'layerInput', fitMode: 'cover', wrapMode: 'repeatMirrored', filterMode: 'linear' });
	assert.deepEqual(modified.layer.compositingParamValues.blendMode, literal('replace'));
	modified.edit(['inputA'], { kind: 'literal', value: [1, 0, 0, 1] });
	const reset = modified.edit(['inputA'], { kind: 'reset' });
	assert.equal(modified.read(['inputA']).inputSource, 'layerInput');
	reset.undo(modified.state);
	assert.deepEqual(modified.read(['inputA']), literal([1, 0, 0, 1]));
	reset.execute(modified.state);
	assert.equal(effectDefinitions.colorMix.paramDefs.inputA.defaultValue.inputSource, 'literal');
	assert.deepEqual(modified.layer.resolution, { mode: 'auto' });
	const noPrimary = createEffectTimelineLayer({ ...effectDefinitions.grid, kind: 'modify', primaryInputParameter: null }, 0);
	assert.equal(noPrimary.effectParamValues.background.inputSource, 'literal');
});

// 【要素の並べ替え・削除・Undo/Redo後もIDパスでキーを扱う】
// キーをレイヤーの別テーブルへ分離せず要素内のBindingに保持し、削除と復元を一つの操作にする。
test('edits nested scene-time keyframes and preserves identity through array operations', () => {
	const f = fixture();
	const path = ['buzzs', 'first', 'x'];
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
	const move = COMMAND_DEFS.moveTimelineKeyframes.create({ sceneId: 'scene', positions: [{ ...f.target, paramPath: path, keyframeId: 'key', x: 400 }] });
	move.execute(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 400);
	move.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	assert.deepEqual(getLayerKeyframeParameters(f.state, f.layer).map(param => param.paramPath), [path]);
	const remove = f.edit(['buzzs'], { kind: 'removeElement', elementId: 'first' });
	assert.equal(getLayerKeyframeParameters(f.state, f.layer).length, 0);
	assert.throws(() => f.edit(path, { kind: 'literal', value: 1 }), /Unknown array element/);
	remove.undo(f.state);
	assert.equal(f.read(path).keyframesTimeline.keyframes[0].x, 121);
	const reset = f.edit(['buzzs'], { kind: 'reset' });
	const resetId = f.read(['buzzs']).value[0].id;
	assert.notEqual(resetId, 'first');
	reset.undo(f.state);
	reset.execute(f.state);
	assert.equal(f.read(['buzzs']).value[0].id, resetId);
});

// 【非主入力の配列要素にも下層入力を設定し、利用スコープと型互換性を分ける】
// forceTypeSafetyを無効にした既存プロジェクトを開けるよう型不一致は許可しつつ、
// canNodeでない末端・コンテナ・合成設定・モジュール内部には下層入力を流さない。
test('supports secondary layer inputs and enforces their scope independently of type preferences', () => {
	const f = fixture();
	const path = ['buzzs', 'first', 'image'];
	f.edit(path, { kind: 'inputSource', inputSource: 'layerInput' });
	f.edit(path, { kind: 'layerInput', value: { ...f.read(path), fitMode: 'contain', wrapMode: 'transparent', filterMode: 'nearest' } });
	assert.equal(f.read(path).filterMode, 'nearest');
	for (const invalid of [['buzzs', 'first', 'x'], ['buzzs']]) assert.throws(() => f.edit(invalid, { kind: 'inputSource', inputSource: 'layerInput' }));
	assert.throws(() => COMMAND_DEFS.editTimelineLayerParam.create({ ...f.target, target: 'compositing', paramPath: ['opacity'], edit: { kind: 'inputSource', inputSource: 'layerInput' } }).execute(f.state));
	for (const inputSource of ['node', 'externalCustomParameterInput']) assert.throws(() => f.edit(path, { kind: 'inputSource', inputSource }));
	const input = { kind: 'scalar' };
	preferences.s.forceTypeSafety = false;
	assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), true);
	assert.equal(areNodeDataTypesCompatible({ kind: 'color' }, input), false);
	preferences.s.forceTypeSafety = true;
	assert.equal(canConnectNodeDataTypes({ kind: 'color' }, input), false);
	for (const kind of ['color', 'any']) assert.equal(canConnectNodeDataTypes({ kind: 'color' }, { kind }), true);
	preferences.s.forceTypeSafety = false;
});

// 【エフェクト・解像度・ネストしたBindingをプロジェクト保存で維持する】
// クリップ追加や解像度変更でもエフェクト種別とパラメータの所有者はレイヤーのままにする。
test('round trips effect layers and changes resolution and clips with undo', async () => {
	const f = fixture();
	f.edit(['buzzs', 'first', 'image'], { kind: 'inputSource', inputSource: 'layerInput' });
	const resolution = COMMAND_DEFS.changeEffectLayerResolution.create({ ...f.target, resolution: { mode: 'customAbsolute', width: 640, height: 360 } });
	resolution.execute(f.state);
	const add = COMMAND_DEFS.addTimelineClip.create({ ...f.target, clip: { id: 'second', startMs: 6000, durationMs: 1000, contentOffsetMs: 50.25 } });
	add.execute(f.state);
	const project = { timelineFps: 60, timelineMotionBlur: { enabled: false, shutterAngle: 180, samples: 16 }, id: 'project', gsVersion: '2.0.0-alpha', name: 'Test', description: '', author: '', resolution: { width: 800, height: 600 },
		assets: [], players: [], visualModules: [], timelineScenes: f.state.timelineScenes.value };
	assert.deepEqual(decodeProjectFile(await encodeProjectFile(project)), project);
	resolution.undo(f.state);
	assert.deepEqual(f.layer.resolution, { mode: 'auto' });
	add.undo(f.state);
	assert.equal(f.layer.clips.length, 1);
	assert.equal(f.read(['buzzs', 'first', 'image']).inputSource, 'layerInput');
});
